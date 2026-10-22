use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub temperature: f32,
    pub max_tokens: u32,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            timeout_ms: 60_000,
            temperature: 0.4,
            max_tokens: 2048,
        }
    }
}

impl ProviderConfig {
    pub fn validate(&self) -> crate::error::AppResult<()> {
        let url = self.base_url.trim();
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return Err(crate::error::AppError::invalid(
                "base URL must start with http:// or https://",
            ));
        }
        if self.model.trim().is_empty() {
            return Err(crate::error::AppError::invalid("model name is required"));
        }
        if self.timeout_ms < 1_000 || self.timeout_ms > 600_000 {
            return Err(crate::error::AppError::invalid(
                "timeout must be between 1 and 600 seconds",
            ));
        }
        if self.max_tokens < 64 || self.max_tokens > 32_768 {
            return Err(crate::error::AppError::invalid(
                "max tokens must be between 64 and 32768",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigView {
    pub base_url: String,
    pub model: String,
    pub timeout_ms: u64,
    pub temperature: f32,
    pub max_tokens: u32,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub root_path: String,
    pub name: String,
    pub style_profile_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDocument {
    pub id: String,
    pub canonical_path: String,
    pub title: String,
    pub project_id: Option<String>,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminologyRule {
    pub term: String,
    pub preferred: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct StyleRules {
    pub audience: String,
    pub tone: String,
    pub terminology: Vec<TerminologyRule>,
    pub banned: Vec<String>,
    pub notes: String,
}

impl StyleRules {
    pub fn is_empty(&self) -> bool {
        self.audience.trim().is_empty()
            && self.tone.trim().is_empty()
            && self.terminology.is_empty()
            && self.banned.is_empty()
            && self.notes.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleProfile {
    pub id: String,
    pub project_id: String,
    pub version: i64,
    pub rules: StyleRules,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    pub id: String,
    pub document_id: String,
    pub content_hash: String,
    pub source: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFile {
    pub record: SnapshotRecord,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub citations: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub document_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}
