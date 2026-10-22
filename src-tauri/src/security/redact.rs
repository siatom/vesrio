//! Log and audit redaction.
//!
//! Nothing in this module may write document text or API keys. Structured
//! fields are filtered by key name and free-form strings are scrubbed for
//! common secret shapes before they reach disk or the UI.

use regex::Regex;
use serde_json::{Map, Value};
use std::sync::OnceLock;

fn secret_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            Regex::new(r"sk-[A-Za-z0-9_\-]{8,}").unwrap(),
            Regex::new(r"(?i)bearer\s+[A-Za-z0-9._\-]+").unwrap(),
            Regex::new(r"(?i)api[_-]?key\s*[:=]\s*[A-Za-z0-9._\-]{4,}").unwrap(),
            Regex::new(r"(?i)authorization\s*[:=]\s*\S+").unwrap(),
        ]
    })
}

pub fn redact_text(input: &str) -> String {
    let mut output = input.to_string();
    for pattern in secret_patterns() {
        output = pattern.replace_all(&output, "[REDACTED]").into_owned();
    }
    output
}

pub fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        "key",
        "secret",
        "token",
        "authorization",
        "password",
        "content",
        "text",
        "document",
        "prompt",
        "message",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, inner) in map {
                if is_sensitive_key(key) {
                    out.insert(key.clone(), Value::String("[REDACTED]".into()));
                } else {
                    out.insert(key.clone(), redact_json(inner));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_json).collect()),
        Value::String(text) => Value::String(redact_text(text)),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_common_key_shapes() {
        let text = "Authorization: Bearer abc123\napi_key=sk-abcdefgh12345";
        let redacted = redact_text(text);
        assert!(!redacted.contains("sk-abcdefgh"));
        assert!(!redacted.contains("abc123"));
        assert!(redacted.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_sensitive_json_keys_and_nested_strings() {
        let input = json!({
            "requestId": "r1",
            "apiKey": "sk-1234567890",
            "content": "secret document body",
            "nested": { "token": "abc", "code": "timeout" }
        });
        let out = redact_json(&input);
        assert_eq!(out["apiKey"], "[REDACTED]");
        assert_eq!(out["content"], "[REDACTED]");
        assert_eq!(out["nested"]["token"], "[REDACTED]");
        assert_eq!(out["nested"]["code"], "timeout");
        assert_eq!(out["requestId"], "r1");
    }
}
