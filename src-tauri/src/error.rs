//! Unified, serializable error contract for every Tauri command.
//!
//! Frontend code switches on stable `code` values and never renders raw
//! internal messages for sensitive failures. Messages must stay free of
//! document text, filesystem secrets and API keys.

use serde::ser::{Serialize, SerializeStruct, Serializer};
use serde::Serialize as DeriveSerialize;

#[derive(Debug, Clone, DeriveSerialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Io {
        message: String,
        path: Option<String>,
    },
    #[error("File is not valid UTF-8 (detected {encoding})")]
    UnsupportedEncoding { encoding: String },
    #[error("Unsupported document type: {extension}")]
    UnsupportedDocumentType { extension: String },
    #[error("Document not found: {id}")]
    NotFound { id: String },
    #[error("The file changed on disk since it was opened")]
    Conflict {
        disk_hash: String,
        expected_hash: String,
    },
    #[error("Permission denied: {message}")]
    Permission { message: String },
    #[error("Storage error: {message}")]
    Storage { message: String },
    #[error("Invalid input: {message}")]
    InvalidInput { message: String },
    #[error("Provider error: {message}")]
    Provider {
        message: String,
        retryable: bool,
        status: Option<u16>,
    },
    #[error("The request was cancelled")]
    Cancelled,
    #[error("This suggestion is stale and cannot be applied")]
    Stale { reason: String },
    #[error("Illegal state transition: {from} -> {to}")]
    InvalidTransition { from: String, to: String },
    #[error("Not configured: {message}")]
    NotConfigured { message: String },
    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl AppError {
    pub fn io(message: impl Into<String>, path: Option<&std::path::Path>) -> Self {
        Self::Io {
            message: message.into(),
            path: path.map(|p| p.to_string_lossy().to_string()),
        }
    }

    pub fn storage(error: impl std::fmt::Display) -> Self {
        Self::Storage {
            message: error.to_string(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
        }
    }

    pub fn provider(message: impl Into<String>, retryable: bool, status: Option<u16>) -> Self {
        Self::Provider {
            message: message.into(),
            retryable,
            status,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Io { .. } => "io_error",
            Self::UnsupportedEncoding { .. } => "unsupported_encoding",
            Self::UnsupportedDocumentType { .. } => "unsupported_document_type",
            Self::NotFound { .. } => "not_found",
            Self::Conflict { .. } => "external_conflict",
            Self::Permission { .. } => "permission_denied",
            Self::Storage { .. } => "storage_error",
            Self::InvalidInput { .. } => "invalid_input",
            Self::Provider { .. } => "provider_error",
            Self::Cancelled => "cancelled",
            Self::Stale { .. } => "stale_suggestion",
            Self::InvalidTransition { .. } => "invalid_transition",
            Self::NotConfigured { .. } => "not_configured",
            Self::Internal { .. } => "internal_error",
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            Self::Provider { retryable, .. } => *retryable,
            Self::Io { .. } | Self::Storage { .. } | Self::Internal { .. } => true,
            _ => false,
        }
    }

    pub fn details(&self) -> Option<serde_json::Value> {
        match self {
            Self::Io { path, .. } => path.as_ref().map(|p| serde_json::json!({ "path": p })),
            Self::UnsupportedEncoding { encoding } => {
                Some(serde_json::json!({ "encoding": encoding }))
            }
            Self::UnsupportedDocumentType { extension } => {
                Some(serde_json::json!({ "extension": extension }))
            }
            Self::Conflict {
                disk_hash,
                expected_hash,
            } => Some(serde_json::json!({
                "diskHash": disk_hash,
                "expectedHash": expected_hash,
                "options": ["reload", "keep_current", "save_as"]
            })),
            Self::Provider { status, .. } => status.map(|s| serde_json::json!({ "status": s })),
            Self::Stale { reason } => Some(serde_json::json!({ "reason": reason })),
            Self::InvalidTransition { from, to } => {
                Some(serde_json::json!({ "from": from, "to": to }))
            }
            _ => None,
        }
    }

    pub fn payload(&self) -> ErrorPayload {
        ErrorPayload {
            code: self.code().to_string(),
            message: self.to_string(),
            retryable: self.retryable(),
            details: self.details(),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let payload = self.payload();
        let mut state = serializer.serialize_struct("ErrorPayload", 4)?;
        state.serialize_field("code", &payload.code)?;
        state.serialize_field("message", &payload.message)?;
        state.serialize_field("retryable", &payload.retryable)?;
        state.serialize_field("details", &payload.details)?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
            path: None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage {
            message: error.to_string(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::Internal {
            message: format!("serialization failed: {error}"),
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_error_exposes_safe_options() {
        let err = AppError::Conflict {
            disk_hash: "a".into(),
            expected_hash: "b".into(),
        };
        let payload = err.payload();
        assert_eq!(payload.code, "external_conflict");
        assert!(!payload.retryable);
        assert_eq!(
            payload.details.unwrap()["options"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
    }

    #[test]
    fn provider_error_retryability_is_preserved() {
        let err = AppError::provider("rate limited", true, Some(429));
        assert!(err.retryable());
        assert_eq!(err.payload().details.unwrap()["status"], 429);
    }
}
