//! OpenAI-compatible HTTP adapter.
//!
//! All model output is untrusted text. This layer only streams text deltas and
//! normalizes errors; it has no filesystem or tool access.

use super::secrets::SecretStore;
use crate::error::{AppError, AppResult};
use crate::security::redact_text;
use crate::storage::models::ProviderConfig;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

// DeepSeek may be configured for up to 384K output tokens. Chinese text is
// roughly one character per token, so keep a 1M-character safety ceiling.
const MAX_COMPLETION_CHARS: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
        }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
        }
    }
}

pub struct ProviderClient;

impl ProviderClient {
    pub async fn test_connection(config: &ProviderConfig, key: &str) -> AppResult<Vec<String>> {
        config.validate()?;
        let client = http_client()?;
        let url = models_url(&config.base_url);
        let response = tokio::time::timeout(
            Duration::from_millis(config.timeout_ms.min(20_000)),
            client.get(&url).bearer_auth(key).send(),
        )
        .await
        .map_err(|_| AppError::provider("connection test timed out", true, None))?
        .map_err(map_transport)?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(map_http_error(status.as_u16(), &body));
        }
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
        let models = parsed["data"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item["id"].as_str().map(|s| s.to_string()))
                    .take(200)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(models)
    }

    /// Stream a chat completion. Deltas are forwarded to `on_delta`; the full
    /// text is returned only after a clean `[DONE]`. A canceled or failed
    /// stream never returns partial text to the caller.
    pub async fn stream_chat<F>(
        config: &ProviderConfig,
        key: &str,
        messages: Vec<ChatMessage>,
        cancel: CancellationToken,
        mut on_delta: F,
    ) -> AppResult<String>
    where
        F: FnMut(&str),
    {
        config.validate()?;
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let future = async {
            let client = http_client()?;
            let url = chat_url(&config.base_url);
            let body = json!({
                "model": config.model,
                "messages": messages,
                "stream": true,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
            });
            let response = client
                .post(&url)
                .bearer_auth(key)
                .json(&body)
                .send()
                .await
                .map_err(map_transport)?;
            let status = response.status();
            if !status.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(map_http_error(status.as_u16(), &body));
            }

            let is_sse = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_ascii_lowercase().contains("text/event-stream"))
                .unwrap_or(false);

            if !is_sse {
                let body = response.text().await.map_err(map_transport)?;
                let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
                    AppError::provider("provider returned invalid JSON", false, None)
                })?;
                if let Some(error) = parsed.get("error") {
                    return Err(AppError::provider(
                        format!("provider error: {}", error_message(error)),
                        false,
                        None,
                    ));
                }
                let text = parsed["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                if text.is_empty() {
                    return Err(AppError::provider(
                        "provider returned an empty completion",
                        true,
                        None,
                    ));
                }
                if text.chars().count() > MAX_COMPLETION_CHARS {
                    return Err(AppError::provider(
                        "provider response exceeded the size limit",
                        false,
                        None,
                    ));
                }
                on_delta(&text);
                return Ok(text);
            }

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut full = String::new();
            let mut saw_done = false;

            loop {
                let next = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(AppError::Cancelled),
                    next = stream.next() => next,
                };
                let Some(chunk) = next else { break };
                let chunk = chunk.map_err(map_transport)?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(position) = buffer.find('\n') {
                    let line: String = buffer.drain(..=position).collect();
                    let line = line.trim_end_matches(['\r', '\n']).trim();
                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }
                    let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
                    if payload == "[DONE]" {
                        saw_done = true;
                        break;
                    }
                    if !payload.starts_with('{') {
                        continue;
                    }
                    let parsed: serde_json::Value = match serde_json::from_str(payload) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if let Some(error) = parsed.get("error") {
                        return Err(AppError::provider(
                            format!("provider error: {}", error_message(error)),
                            false,
                            None,
                        ));
                    }
                    let delta = parsed["choices"][0]["delta"]["content"]
                        .as_str()
                        .or_else(|| parsed["choices"][0]["message"]["content"].as_str())
                        .unwrap_or_default();
                    if !delta.is_empty() {
                        if full.chars().count() + delta.chars().count() > MAX_COMPLETION_CHARS {
                            return Err(AppError::provider(
                                "provider response exceeded the size limit",
                                false,
                                None,
                            ));
                        }
                        full.push_str(delta);
                        on_delta(delta);
                    }
                }
                if saw_done {
                    break;
                }
            }

            if full.trim().is_empty() {
                return Err(AppError::provider(
                    "provider returned an empty completion",
                    true,
                    None,
                ));
            }
            if !saw_done {
                return Err(AppError::provider(
                    "provider stream ended before completion",
                    true,
                    None,
                ));
            }
            Ok(full)
        };

        tokio::time::timeout(Duration::from_millis(config.timeout_ms), future)
            .await
            .map_err(|_| AppError::provider("provider request timed out", true, None))?
    }

    pub async fn require_key(store: &dyn SecretStore) -> AppResult<String> {
        store.get()?.ok_or_else(|| AppError::NotConfigured {
            message: "no API key is configured".into(),
        })
    }
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Vesrio/0.1")
        .build()
        .map_err(|e| AppError::internal(format!("could not create HTTP client: {e}")))
}

fn chat_url(base: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{base}/chat/completions")
    }
}

fn models_url(base: &str) -> String {
    let base = base.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.trim_end_matches("/chat/completions").to_string() + "/models"
    } else {
        format!("{base}/models")
    }
}

fn map_transport(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::provider("network timeout while contacting the provider", true, None)
    } else if error.is_connect() {
        AppError::provider("could not connect to the provider", true, None)
    } else {
        AppError::provider(
            format!("network error: {}", redact_text(&error.to_string())),
            true,
            None,
        )
    }
}

fn map_http_error(status: u16, body: &str) -> AppError {
    let snippet: String = redact_text(body).chars().take(300).collect();
    let (message, retryable) = match status {
        401 | 403 => ("authentication failed; check the API key", false),
        404 => ("endpoint not found; check the base URL and model", false),
        429 => ("provider rate limit reached", true),
        400 | 422 => (
            "provider rejected the request; check the model and parameters",
            false,
        ),
        500..=599 => ("provider server error", true),
        _ => ("provider request failed", false),
    };
    AppError::provider(
        if snippet.is_empty() {
            message.to_string()
        } else {
            format!("{message}: {snippet}")
        },
        retryable,
        Some(status),
    )
}

fn error_message(error: &serde_json::Value) -> String {
    error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .unwrap_or("unknown provider error")
        .chars()
        .take(300)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn fake_server(response: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = vec![0u8; 8192];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        format!("http://{address}/v1")
    }

    fn sse_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[tokio::test]
    async fn streams_sse_deltas() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let base = fake_server(sse_response(body)).await;
        let config = ProviderConfig {
            base_url: base,
            ..Default::default()
        };
        let deltas = Arc::new(Mutex::new(String::new()));
        let collected = deltas.clone();
        let text = ProviderClient::stream_chat(
            &config,
            "test-key",
            vec![ChatMessage::user("hi")],
            CancellationToken::new(),
            move |delta| collected.lock().unwrap().push_str(delta),
        )
        .await
        .unwrap();
        assert_eq!(text, "你好");
        assert_eq!(*deltas.lock().unwrap(), "你好");
    }

    #[tokio::test]
    async fn maps_authentication_errors() {
        let body = "{\"error\":{\"message\":\"invalid key\"}}";
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let base = fake_server(response).await;
        let config = ProviderConfig {
            base_url: base,
            ..Default::default()
        };
        let err = ProviderClient::stream_chat(
            &config,
            "bad",
            vec![ChatMessage::user("hi")],
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "provider_error");
        assert!(!err.retryable());
        match err {
            AppError::Provider { status, .. } => assert_eq!(status, Some(401)),
            _ => unreachable!(),
        }
    }

    #[tokio::test]
    async fn cancellation_wins_before_the_request() {
        let config = ProviderConfig::default();
        let cancel = CancellationToken::new();
        cancel.cancel();
        let err = ProviderClient::stream_chat(
            &config,
            "k",
            vec![ChatMessage::user("hi")],
            cancel,
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(err.code(), "cancelled");
    }

    #[tokio::test]
    async fn truncated_stream_is_an_error_not_a_partial_result() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"半\"}}]}\n\n";
        let base = fake_server(sse_response(body)).await;
        let config = ProviderConfig {
            base_url: base,
            ..Default::default()
        };
        let err = ProviderClient::stream_chat(
            &config,
            "k",
            vec![ChatMessage::user("hi")],
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("ended before completion"));
    }
}
