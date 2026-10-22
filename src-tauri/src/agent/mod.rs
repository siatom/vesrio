//! Agent chat orchestration: read-only context, persisted conversations and
//! citation resolution. There is deliberately no write path here.

use crate::error::{AppError, AppResult};
use crate::provider::secrets::SecretStore;
use crate::provider::{ChatMessage, ProviderClient};
use crate::storage::models::{ConversationRecord, MessageRecord, StyleRules};
use crate::storage::{Db, NewRequest, RequestRecord};
use crate::suggestion::prompt::{
    build_agent_messages, extract_citations, strip_citation_markers, Citation,
};
use crate::suggestion::service::latest_style;
use crate::suggestion::state::RequestStatus;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const MAX_QUESTION_CHARS: usize = 4000;
const MAX_CONTEXT_CHARS: usize = 120_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareChatInput {
    pub document_id: String,
    pub project_id: Option<String>,
    pub document_title: String,
    pub document_text: String,
    pub question: String,
    pub read_scope: String,
    pub from_utf16: Option<usize>,
    pub to_utf16: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedChat {
    pub request_id: String,
    pub conversation_id: String,
    pub messages: Vec<ChatMessage>,
    pub outbound_chars: usize,
    pub read_scope: String,
    pub model: String,
    pub provider_host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredChatPayload {
    messages: Vec<ChatMessage>,
    question: String,
    conversation_id: String,
    read_scope: String,
    style: StyleRules,
    document_title: String,
}

pub fn prepare(db: &Db, input: PrepareChatInput) -> AppResult<PreparedChat> {
    let question = input.question.trim();
    if question.is_empty() {
        return Err(AppError::invalid("question must not be empty"));
    }
    if question.chars().count() > MAX_QUESTION_CHARS {
        return Err(AppError::invalid("question is too long"));
    }
    let context = match input.read_scope.as_str() {
        "selection" => {
            let from = input
                .from_utf16
                .ok_or_else(|| AppError::invalid("selection start is missing"))?;
            let to = input
                .to_utf16
                .ok_or_else(|| AppError::invalid("selection end is missing"))?;
            crate::suggestion::anchor::slice_utf16(&input.document_text, from, to)?.to_string()
        }
        "document" => {
            let total = input.document_text.chars().count();
            if total <= MAX_CONTEXT_CHARS {
                input.document_text.clone()
            } else {
                let truncated: String = input
                    .document_text
                    .chars()
                    .take(MAX_CONTEXT_CHARS)
                    .collect();
                format!("{truncated}\n\n[已截断，共 {total} 字]")
            }
        }
        _ => return Err(AppError::invalid("unsupported read scope")),
    };

    let (_profile, style) = latest_style(db, input.project_id.as_deref())?;
    let conversation = db.latest_or_create_conversation(
        &input.document_id,
        input.project_id.as_deref(),
        &title_from(question),
    )?;
    let history: Vec<ChatMessage> = db
        .list_messages(&conversation.id, 40)?
        .into_iter()
        .filter(|message| message.role == "user" || message.role == "assistant")
        .map(|message| ChatMessage {
            role: message.role,
            content: strip_citation_markers(&message.content),
        })
        .collect();

    let messages = build_agent_messages(
        question,
        &input.document_title,
        &context,
        &style,
        &history,
        &input.read_scope,
    );
    let outbound_chars = messages.iter().map(|m| m.content.chars().count()).sum();
    let config = db.provider_config()?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let payload = StoredChatPayload {
        messages: messages.clone(),
        question: question.to_string(),
        conversation_id: conversation.id.clone(),
        read_scope: input.read_scope.clone(),
        style,
        document_title: input.document_title.clone(),
    };
    db.create_request(&NewRequest {
        id: request_id.clone(),
        document_id: Some(input.document_id.clone()),
        project_id: input.project_id.clone(),
        kind: "agent".into(),
        intent: "chat".into(),
        read_scope: input.read_scope.clone(),
        write_scope: "none".into(),
        base_revision: 0,
        payload: serde_json::to_value(&payload)?,
    })?;

    Ok(PreparedChat {
        request_id,
        conversation_id: conversation.id,
        messages,
        outbound_chars,
        read_scope: input.read_scope,
        model: config.model,
        provider_host: provider_host(&config.base_url),
    })
}

fn title_from(question: &str) -> String {
    let cleaned: String = question.chars().take(40).collect();
    if cleaned.trim().is_empty() {
        "新对话".into()
    } else {
        cleaned
    }
}

fn provider_host(base_url: &str) -> String {
    base_url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or(base_url)
        .to_string()
}

fn stored_payload(request: &RequestRecord) -> AppResult<StoredChatPayload> {
    serde_json::from_value(request.payload.clone())
        .map_err(|_| AppError::internal("stored chat payload is invalid"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutcome {
    pub conversation_id: String,
    pub message: MessageRecord,
    pub citations: Vec<Citation>,
}

pub async fn execute<F>(
    db: &Db,
    secrets: &dyn SecretStore,
    request_id: &str,
    document_text: &str,
    cancel: CancellationToken,
    mut on_delta: F,
) -> AppResult<ChatOutcome>
where
    F: FnMut(&str),
{
    let request = db.get_request(request_id)?;
    if request.kind != "agent" {
        return Err(AppError::invalid("request is not an agent request"));
    }
    if request.status != RequestStatus::Prepared {
        return Err(AppError::InvalidTransition {
            from: request.status.as_str().to_string(),
            to: RequestStatus::Generating.as_str().to_string(),
        });
    }
    let payload = stored_payload(&request)?;
    let config = db.provider_config()?;
    let key = match secrets.get()? {
        Some(key) => key,
        None => {
            let _ = db.update_request_status(
                request_id,
                RequestStatus::Failed,
                Some(("not_configured", "no API key is configured")),
            );
            return Err(AppError::NotConfigured {
                message: "configure a model provider and API key first".into(),
            });
        }
    };

    db.update_request_status(request_id, RequestStatus::Generating, None)?;
    db.insert_message(
        &payload.conversation_id,
        "user",
        &payload.question,
        &serde_json::json!([]),
    )?;

    let result =
        ProviderClient::stream_chat(&config, &key, payload.messages.clone(), cancel, |delta| {
            on_delta(delta)
        })
        .await;

    match result {
        Ok(content) => {
            let citations = extract_citations(&content, document_text);
            let citations_json = serde_json::to_value(&citations)?;
            let message = db.insert_message(
                &payload.conversation_id,
                "assistant",
                &content,
                &citations_json,
            )?;
            db.update_request_status(request_id, RequestStatus::Completed, None)?;
            Ok(ChatOutcome {
                conversation_id: payload.conversation_id,
                message,
                citations,
            })
        }
        Err(error) => {
            let (status, code) = if error.code() == "cancelled" {
                (RequestStatus::Canceled, "cancelled")
            } else {
                (RequestStatus::Failed, error.code())
            };
            let _ = db.update_request_status(request_id, status, Some((code, &error.to_string())));
            Err(error)
        }
    }
}

pub fn history(db: &Db, conversation_id: &str) -> AppResult<Vec<MessageRecord>> {
    db.list_messages(conversation_id, 300)
}

pub fn conversation_for_document(
    db: &Db,
    document_id: &str,
    project_id: Option<&str>,
) -> AppResult<ConversationRecord> {
    db.latest_or_create_conversation(document_id, project_id, "文档对话")
}
