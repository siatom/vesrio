//! SQLite metadata store with versioned migrations.
//!
//! Migrations run in a single transaction. Before upgrading an existing
//! database a timestamped backup is copied next to it. The API key is never
//! stored here: see `provider::secrets`.

use super::models::*;
use crate::error::{AppError, AppResult};
use crate::suggestion::state::{RequestStatus, SuggestionStatus};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: include_str!("../../migrations/0001_init.sql"),
}];

struct Migration {
    version: i64,
    sql: &'static str,
}

pub struct Db {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct NewRequest {
    pub id: String,
    pub document_id: Option<String>,
    pub project_id: Option<String>,
    pub kind: String,
    pub intent: String,
    pub read_scope: String,
    pub write_scope: String,
    pub base_revision: i64,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct RequestRecord {
    pub id: String,
    pub document_id: Option<String>,
    pub project_id: Option<String>,
    pub kind: String,
    pub intent: String,
    pub read_scope: String,
    pub write_scope: String,
    pub base_revision: i64,
    pub status: RequestStatus,
    pub payload: serde_json::Value,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateRecord {
    pub idx: i64,
    pub candidate_text: String,
    pub rationale: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionRecord {
    pub id: String,
    pub request_id: String,
    pub document_id: String,
    pub from_utf16: i64,
    pub to_utf16: i64,
    pub selected_text_hash: String,
    pub original_text: String,
    pub candidate_text: String,
    pub rationale: String,
    pub warnings: Vec<String>,
    pub status: SuggestionStatus,
    pub selected_candidate: i64,
    pub applied_from_utf16: Option<i64>,
    pub applied_to_utf16: Option<i64>,
    pub applied_text_hash: Option<String>,
    pub snapshot_id: Option<String>,
    pub candidates: Vec<CandidateRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct NewSuggestion {
    pub id: String,
    pub request_id: String,
    pub document_id: String,
    pub from_utf16: i64,
    pub to_utf16: i64,
    pub selected_text_hash: String,
    pub original_text: String,
    pub candidate_text: String,
    pub rationale: String,
    pub warnings: Vec<String>,
    pub candidates: Vec<CandidateRecord>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                AppError::io(
                    format!("could not create application data folder: {e}"),
                    Some(parent),
                )
            })?;
        }
        let mut conn = Connection::open(path)?;
        configure(&conn)?;
        migrate(&mut conn, Some(path), MIGRATIONS)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let mut conn = Connection::open_in_memory()?;
        configure(&conn)?;
        migrate(&mut conn, None, MIGRATIONS)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))
    }

    // ---------- settings ----------

    pub fn all_settings(&self) -> AppResult<Vec<(String, String)>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT key, value FROM app_settings ORDER BY key")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now()],
        )?;
        Ok(())
    }

    // ---------- provider ----------

    pub fn provider_config(&self) -> AppResult<ProviderConfig> {
        let conn = self.lock()?;
        let config = conn
            .query_row(
                "SELECT base_url, model, timeout_ms, temperature, max_tokens FROM provider_configs WHERE id = 'default'",
                [],
                |row| {
                    Ok(ProviderConfig {
                        base_url: row.get(0)?,
                        model: row.get(1)?,
                        timeout_ms: row.get::<_, i64>(2)? as u64,
                        temperature: row.get::<_, f64>(3)? as f32,
                        max_tokens: row.get::<_, i64>(4)? as u32,
                    })
                },
            )
            .optional()?;
        Ok(config.unwrap_or_default())
    }

    pub fn save_provider_config(&self, config: &ProviderConfig) -> AppResult<()> {
        config.validate()?;
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO provider_configs (id, base_url, model, timeout_ms, temperature, max_tokens, updated_at)
             VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, model=excluded.model,
               timeout_ms=excluded.timeout_ms, temperature=excluded.temperature,
               max_tokens=excluded.max_tokens, updated_at=excluded.updated_at",
            params![
                config.base_url.trim(),
                config.model.trim(),
                config.timeout_ms as i64,
                config.temperature as f64,
                config.max_tokens as i64,
                now()
            ],
        )?;
        Ok(())
    }

    // ---------- projects & documents ----------

    pub fn get_or_create_project(&self, root_path: &str, name: &str) -> AppResult<Project> {
        let conn = self.lock()?;
        let existing = conn
            .query_row(
                "SELECT id, root_path, name, style_profile_id, created_at FROM projects WHERE root_path = ?1",
                params![root_path],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        root_path: row.get(1)?,
                        name: row.get(2)?,
                        style_profile_id: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        if let Some(project) = existing {
            return Ok(project);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = now();
        conn.execute(
            "INSERT INTO projects (id, root_path, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
            params![id, root_path, name, timestamp],
        )?;
        Ok(Project {
            id,
            root_path: root_path.to_string(),
            name: name.to_string(),
            style_profile_id: None,
            created_at: timestamp,
        })
    }

    pub fn list_projects(&self) -> AppResult<Vec<Project>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, root_path, name, style_profile_id, created_at FROM projects ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    root_path: row.get(1)?,
                    name: row.get(2)?,
                    style_profile_id: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert_document(
        &self,
        canonical_path: &str,
        title: &str,
        project_id: Option<&str>,
    ) -> AppResult<String> {
        let conn = self.lock()?;
        let timestamp = now();
        conn.execute(
            "INSERT INTO documents (id, canonical_path, title, project_id, last_opened_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(canonical_path) DO UPDATE SET
               title = excluded.title,
               project_id = COALESCE(excluded.project_id, documents.project_id),
               last_opened_at = excluded.last_opened_at",
            params![
                uuid::Uuid::new_v4().to_string(),
                canonical_path,
                title,
                project_id,
                timestamp
            ],
        )?;
        let id: String = conn.query_row(
            "SELECT id FROM documents WHERE canonical_path = ?1",
            params![canonical_path],
            |row| row.get(0),
        )?;
        Ok(id)
    }

    pub fn recent_documents(&self, limit: usize) -> AppResult<Vec<RecentDocument>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, canonical_path, title, project_id, last_opened_at
             FROM documents ORDER BY last_opened_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(RecentDocument {
                    id: row.get(0)?,
                    canonical_path: row.get(1)?,
                    title: row.get(2)?,
                    project_id: row.get(3)?,
                    last_opened_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---------- requests ----------

    pub fn create_request(&self, request: &NewRequest) -> AppResult<()> {
        let conn = self.lock()?;
        let timestamp = now();
        conn.execute(
            "INSERT INTO requests (id, document_id, project_id, kind, intent, read_scope, write_scope,
               base_revision, status, payload_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                request.id,
                request.document_id,
                request.project_id,
                request.kind,
                request.intent,
                request.read_scope,
                request.write_scope,
                request.base_revision,
                RequestStatus::Prepared.as_str(),
                serde_json::to_string(&request.payload)?,
                timestamp
            ],
        )?;
        Ok(())
    }

    pub fn get_request(&self, id: &str) -> AppResult<RequestRecord> {
        let conn = self.lock()?;
        let record = conn
            .query_row(
                "SELECT id, document_id, project_id, kind, intent, read_scope, write_scope,
                        base_revision, status, payload_json, error_code, error_message
                 FROM requests WHERE id = ?1",
                params![id],
                |row| {
                    let status: String = row.get(8)?;
                    let payload: String = row.get(9)?;
                    Ok(RequestRecord {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        project_id: row.get(2)?,
                        kind: row.get(3)?,
                        intent: row.get(4)?,
                        read_scope: row.get(5)?,
                        write_scope: row.get(6)?,
                        base_revision: row.get(7)?,
                        status: RequestStatus::parse(&status).map_err(|_| {
                            rusqlite::Error::InvalidColumnType(
                                8,
                                "status".into(),
                                rusqlite::types::Type::Text,
                            )
                        })?,
                        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                        error_code: row.get(10)?,
                        error_message: row.get(11)?,
                    })
                },
            )
            .optional()?;
        record.ok_or_else(|| AppError::NotFound { id: id.to_string() })
    }

    pub fn update_request_status(
        &self,
        id: &str,
        next: RequestStatus,
        error: Option<(&str, &str)>,
    ) -> AppResult<()> {
        let request = self.get_request(id)?;
        request.status.assert_transition(next)?;
        let conn = self.lock()?;
        conn.execute(
            "UPDATE requests SET status = ?1, error_code = ?2, error_message = ?3, updated_at = ?4 WHERE id = ?5",
            params![
                next.as_str(),
                error.map(|e| e.0),
                error.map(|e| e.1),
                now(),
                id
            ],
        )?;
        Ok(())
    }

    // ---------- suggestions ----------

    pub fn insert_suggestion(&self, suggestion: &NewSuggestion) -> AppResult<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let timestamp = now();
        tx.execute(
            "INSERT INTO suggestions (id, request_id, document_id, from_utf16, to_utf16,
               selected_text_hash, original_text, candidate_text, rationale, warnings_json,
               status, selected_candidate, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?12)",
            params![
                suggestion.id,
                suggestion.request_id,
                suggestion.document_id,
                suggestion.from_utf16,
                suggestion.to_utf16,
                suggestion.selected_text_hash,
                suggestion.original_text,
                suggestion.candidate_text,
                suggestion.rationale,
                serde_json::to_string(&suggestion.warnings)?,
                SuggestionStatus::Ready.as_str(),
                timestamp
            ],
        )?;
        for candidate in &suggestion.candidates {
            tx.execute(
                "INSERT INTO suggestion_candidates (suggestion_id, idx, candidate_text, rationale)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    suggestion.id,
                    candidate.idx,
                    candidate.candidate_text,
                    candidate.rationale
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_suggestion(&self, id: &str) -> AppResult<SuggestionRecord> {
        let record = {
            let conn = self.lock()?;
            conn.query_row(
                "SELECT id, request_id, document_id, from_utf16, to_utf16, selected_text_hash,
                        original_text, candidate_text, rationale, warnings_json, status,
                        selected_candidate, applied_from_utf16, applied_to_utf16, applied_text_hash,
                        snapshot_id, created_at, updated_at
                 FROM suggestions WHERE id = ?1",
                params![id],
                map_suggestion,
            )
            .optional()?
        }
        .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;
        let candidates = self.load_candidates(&record.id)?;
        Ok(SuggestionRecord {
            candidates,
            ..record
        })
    }

    fn load_candidates(&self, suggestion_id: &str) -> AppResult<Vec<CandidateRecord>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT idx, candidate_text, rationale FROM suggestion_candidates
             WHERE suggestion_id = ?1 ORDER BY idx",
        )?;
        let rows = stmt
            .query_map(params![suggestion_id], |row| {
                Ok(CandidateRecord {
                    idx: row.get(0)?,
                    candidate_text: row.get(1)?,
                    rationale: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_suggestions(
        &self,
        document_id: &str,
        limit: usize,
    ) -> AppResult<Vec<SuggestionRecord>> {
        let ids: Vec<String> = {
            let conn = self.lock()?;
            let mut stmt = conn.prepare(
                "SELECT id FROM suggestions WHERE document_id = ?1 ORDER BY created_at DESC LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![document_id, limit as i64], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()?;
            rows
        };
        ids.into_iter().map(|id| self.get_suggestion(&id)).collect()
    }

    pub fn transition_suggestion(
        &self,
        id: &str,
        next: SuggestionStatus,
    ) -> AppResult<SuggestionRecord> {
        let current = self.get_suggestion(id)?;
        current.status.assert_transition(next)?;
        {
            let conn = self.lock()?;
            conn.execute(
                "UPDATE suggestions SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![next.as_str(), now(), id],
            )?;
        }
        self.get_suggestion(id)
    }

    pub fn mark_suggestion_stale(&self, id: &str) -> AppResult<SuggestionRecord> {
        self.transition_suggestion(id, SuggestionStatus::Stale)
    }

    pub fn mark_suggestion_applied(
        &self,
        id: &str,
        candidate_index: i64,
        from_utf16: i64,
        to_utf16: i64,
        applied_text_hash: &str,
        snapshot_id: &str,
    ) -> AppResult<SuggestionRecord> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let status: String = tx.query_row(
            "SELECT status FROM suggestions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        let current = SuggestionStatus::parse(&status)?;
        if current == SuggestionStatus::Accepted {
            drop(tx);
            drop(conn);
            return self.get_suggestion(id);
        }
        current.assert_transition(SuggestionStatus::Accepted)?;

        let candidate: String = tx
            .query_row(
                "SELECT candidate_text FROM suggestion_candidates WHERE suggestion_id = ?1 AND idx = ?2",
                params![id, candidate_index],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| AppError::invalid("candidate index does not exist"))?;

        tx.execute(
            "UPDATE suggestions SET status = ?1, candidate_text = ?2, selected_candidate = ?3,
               applied_from_utf16 = ?4, applied_to_utf16 = ?5, applied_text_hash = ?6,
               snapshot_id = ?7, updated_at = ?8 WHERE id = ?9",
            params![
                SuggestionStatus::Accepted.as_str(),
                candidate,
                candidate_index,
                from_utf16,
                to_utf16,
                applied_text_hash,
                snapshot_id,
                now(),
                id
            ],
        )?;
        tx.commit()?;
        drop(conn);
        self.get_suggestion(id)
    }

    // ---------- style ----------

    pub fn latest_style(&self, project_id: &str) -> AppResult<Option<StyleProfile>> {
        let conn = self.lock()?;
        let row = conn
            .query_row(
                "SELECT id, project_id, version, rules_json, created_at FROM style_profiles
                 WHERE project_id = ?1 ORDER BY version DESC LIMIT 1",
                params![project_id],
                |row| {
                    let rules: String = row.get(3)?;
                    Ok(StyleProfile {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        version: row.get(2)?,
                        rules: serde_json::from_str(&rules).unwrap_or_default(),
                        created_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    pub fn save_style(&self, project_id: &str, rules: &StyleRules) -> AppResult<StyleProfile> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let version: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM style_profiles WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .unwrap_or(1);
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = now();
        tx.execute(
            "INSERT INTO style_profiles (id, project_id, version, rules_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                project_id,
                version,
                serde_json::to_string(rules)?,
                timestamp
            ],
        )?;
        tx.execute(
            "UPDATE projects SET style_profile_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![id, timestamp, project_id],
        )?;
        tx.commit()?;
        Ok(StyleProfile {
            id,
            project_id: project_id.to_string(),
            version,
            rules: rules.clone(),
            created_at: timestamp,
        })
    }

    // ---------- conversations ----------

    pub fn latest_or_create_conversation(
        &self,
        document_id: &str,
        project_id: Option<&str>,
        title: &str,
    ) -> AppResult<ConversationRecord> {
        {
            let conn = self.lock()?;
            let existing = conn
                .query_row(
                    "SELECT id, document_id, project_id, title, created_at, updated_at
                     FROM conversations WHERE document_id = ?1 ORDER BY updated_at DESC LIMIT 1",
                    params![document_id],
                    |row| {
                        Ok(ConversationRecord {
                            id: row.get(0)?,
                            document_id: row.get(1)?,
                            project_id: row.get(2)?,
                            title: row.get(3)?,
                            created_at: row.get(4)?,
                            updated_at: row.get(5)?,
                        })
                    },
                )
                .optional()?;
            if let Some(conversation) = existing {
                return Ok(conversation);
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = now();
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO conversations (id, project_id, document_id, title, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, project_id, document_id, title, timestamp],
        )?;
        Ok(ConversationRecord {
            id,
            document_id: document_id.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            title: title.to_string(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        })
    }

    pub fn insert_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        citations: &serde_json::Value,
    ) -> AppResult<MessageRecord> {
        let id = uuid::Uuid::new_v4().to_string();
        let timestamp = now();
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, citations_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                conversation_id,
                role,
                content,
                serde_json::to_string(citations)?,
                timestamp
            ],
        )?;
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![timestamp, conversation_id],
        )?;
        Ok(MessageRecord {
            id,
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            citations: citations.clone(),
            created_at: timestamp,
        })
    }

    pub fn list_messages(
        &self,
        conversation_id: &str,
        limit: usize,
    ) -> AppResult<Vec<MessageRecord>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, citations_json, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![conversation_id, limit as i64], |row| {
                let citations: String = row.get(4)?;
                Ok(MessageRecord {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    citations: serde_json::from_str(&citations)
                        .unwrap_or(serde_json::Value::Array(vec![])),
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_conversations(&self, document_id: &str) -> AppResult<Vec<ConversationRecord>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, document_id, project_id, title, created_at, updated_at
             FROM conversations WHERE document_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt
            .query_map(params![document_id], |row| {
                Ok(ConversationRecord {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    project_id: row.get(2)?,
                    title: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ---------- snapshots ----------

    pub fn insert_snapshot(&self, record: &SnapshotRecord, path: &Path) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO snapshots (id, document_id, content_hash, snapshot_path, source, size_bytes, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.id,
                record.document_id,
                record.content_hash,
                path.to_string_lossy(),
                record.source,
                record.size_bytes as i64,
                record.created_at
            ],
        )?;
        Ok(())
    }

    pub fn get_snapshot(&self, id: &str) -> AppResult<(SnapshotRecord, PathBuf)> {
        let conn = self.lock()?;
        let row = conn
            .query_row(
                "SELECT id, document_id, content_hash, snapshot_path, source, size_bytes, created_at
                 FROM snapshots WHERE id = ?1",
                params![id],
                |row| {
                    let record = SnapshotRecord {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        content_hash: row.get(2)?,
                        source: row.get(4)?,
                        size_bytes: row.get::<_, i64>(5)? as u64,
                        created_at: row.get(6)?,
                    };
                    let path: String = row.get(3)?;
                    Ok((record, PathBuf::from(path)))
                },
            )
            .optional()?;
        row.ok_or_else(|| AppError::NotFound { id: id.to_string() })
    }

    pub fn list_snapshots(
        &self,
        document_id: &str,
        limit: usize,
    ) -> AppResult<Vec<SnapshotRecord>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, document_id, content_hash, source, size_bytes, created_at
             FROM snapshots WHERE document_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![document_id, limit as i64], |row| {
                Ok(SnapshotRecord {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    content_hash: row.get(2)?,
                    source: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn snapshot_overflow(
        &self,
        document_id: &str,
        keep: usize,
    ) -> AppResult<Vec<SnapshotRecord>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, document_id, content_hash, source, size_bytes, created_at
             FROM snapshots WHERE document_id = ?1 ORDER BY created_at DESC LIMIT -1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(params![document_id, keep as i64], |row| {
                Ok(SnapshotRecord {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    content_hash: row.get(2)?,
                    source: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete_snapshot(&self, id: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM snapshots WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---------- audit ----------

    pub fn insert_audit(
        &self,
        level: &str,
        event: &str,
        fields: &serde_json::Value,
    ) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO audit_events (id, level, event, fields_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                uuid::Uuid::new_v4().to_string(),
                level,
                event,
                serde_json::to_string(fields)?,
                now()
            ],
        )?;
        Ok(())
    }
}

fn map_suggestion(row: &rusqlite::Row<'_>) -> rusqlite::Result<SuggestionRecord> {
    let status: String = row.get(10)?;
    let warnings: String = row.get(9)?;
    Ok(SuggestionRecord {
        id: row.get(0)?,
        request_id: row.get(1)?,
        document_id: row.get(2)?,
        from_utf16: row.get(3)?,
        to_utf16: row.get(4)?,
        selected_text_hash: row.get(5)?,
        original_text: row.get(6)?,
        candidate_text: row.get(7)?,
        rationale: row.get(8)?,
        warnings: serde_json::from_str(&warnings).unwrap_or_default(),
        status: SuggestionStatus::parse(&status).map_err(|_| {
            rusqlite::Error::InvalidColumnType(10, "status".into(), rusqlite::types::Type::Text)
        })?,
        selected_candidate: row.get(11)?,
        applied_from_utf16: row.get(12)?,
        applied_to_utf16: row.get(13)?,
        applied_text_hash: row.get(14)?,
        snapshot_id: row.get(15)?,
        candidates: Vec::new(),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = NORMAL;",
    )?;
    Ok(())
}

fn migrate(conn: &mut Connection, path: Option<&Path>, migrations: &[Migration]) -> AppResult<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let target = migrations.iter().map(|m| m.version).max().unwrap_or(0);
    if current >= target {
        return Ok(());
    }
    if current > 0 {
        if let Some(db_path) = path {
            backup_database(db_path, current)?;
        }
    }
    let tx = conn.transaction()?;
    for migration in migrations.iter().filter(|m| m.version > current) {
        tx.execute_batch(migration.sql)
            .map_err(|error| AppError::Storage {
                message: format!("migration {} failed: {error}", migration.version),
            })?;
    }
    tx.pragma_update(None, "user_version", target)?;
    tx.commit()?;
    Ok(())
}

fn backup_database(path: &Path, version: i64) -> AppResult<PathBuf> {
    let stamp = Utc::now().format("%Y%m%d%H%M%S");
    let backup = path.with_extension(format!("db.bak-v{version}-{stamp}"));
    fs::copy(path, &backup).map_err(|e| {
        AppError::io(
            format!("could not back up database before migration: {e}"),
            Some(path),
        )
    })?;
    prune_backups(path, 3);
    Ok(backup)
}

fn prune_backups(path: &Path, keep: usize) {
    let Some(parent) = path.parent() else {
        return;
    };
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    let prefix = format!("{name}.bak-v");
    let mut backups: Vec<PathBuf> = fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(prefix.as_str())
        })
        .map(|entry| entry.path())
        .collect();
    backups.sort_by_key(|p| {
        fs::metadata(p)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
    });
    while backups.len() > keep {
        if let Some(oldest) = backups.first().cloned() {
            let _ = fs::remove_file(oldest);
            backups.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::suggestion::state::SuggestionStatus;

    fn suggestion_fixture() -> NewSuggestion {
        NewSuggestion {
            id: "s1".into(),
            request_id: "r1".into(),
            document_id: "d1".into(),
            from_utf16: 0,
            to_utf16: 2,
            selected_text_hash: "hash".into(),
            original_text: "原文".into(),
            candidate_text: "候选".into(),
            rationale: "理由".into(),
            warnings: vec![],
            candidates: vec![CandidateRecord {
                idx: 0,
                candidate_text: "候选".into(),
                rationale: "理由".into(),
            }],
        }
    }

    fn request_fixture() -> NewRequest {
        NewRequest {
            id: "r1".into(),
            document_id: Some("d1".into()),
            project_id: None,
            kind: "suggestion".into(),
            intent: "shorten".into(),
            read_scope: "selection".into(),
            write_scope: "selection_only".into(),
            base_revision: 3,
            payload: serde_json::json!({"messages": []}),
        }
    }

    #[test]
    fn migrations_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vesrio.db");
        let db = Db::open(&path).unwrap();
        drop(db);
        let db = Db::open(&path).unwrap();
        let settings = db.all_settings().unwrap();
        assert!(settings.is_empty());
    }

    #[test]
    fn failed_migration_rolls_back_previous_steps() {
        let mut conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        let migrations = [
            Migration {
                version: 1,
                sql: "CREATE TABLE t (id INTEGER);",
            },
            Migration {
                version: 2,
                sql: "CREATE TABLE broken (;",
            },
        ];
        let err = migrate(&mut conn, None, &migrations).unwrap_err();
        assert_eq!(err.code(), "storage_error");
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='t'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0);
    }

    #[test]
    fn suggestion_state_machine_is_enforced_by_storage() {
        let db = Db::open_in_memory().unwrap();
        db.create_request(&request_fixture()).unwrap();
        db.insert_suggestion(&suggestion_fixture()).unwrap();
        let stale = db.mark_suggestion_stale("s1").unwrap();
        assert_eq!(stale.status, SuggestionStatus::Stale);
        let err = db
            .mark_suggestion_applied("s1", 0, 0, 2, "h", "snap")
            .unwrap_err();
        assert_eq!(err.code(), "invalid_transition");
    }

    #[test]
    fn applying_is_idempotent_and_selects_candidate() {
        let db = Db::open_in_memory().unwrap();
        db.create_request(&request_fixture()).unwrap();
        db.insert_suggestion(&suggestion_fixture()).unwrap();
        let applied = db
            .mark_suggestion_applied("s1", 0, 0, 2, "h", "snap-1")
            .unwrap();
        assert_eq!(applied.status, SuggestionStatus::Accepted);
        assert_eq!(applied.selected_candidate, 0);
        let again = db
            .mark_suggestion_applied("s1", 0, 0, 2, "h", "snap-1")
            .unwrap();
        assert_eq!(again.snapshot_id.as_deref(), Some("snap-1"));
    }

    #[test]
    fn settings_and_provider_config_round_trip_without_secret_column() {
        let db = Db::open_in_memory().unwrap();
        db.set_setting("theme", "\"dark\"").unwrap();
        assert_eq!(db.all_settings().unwrap()[0].1, "\"dark\"");
        let config = ProviderConfig {
            model: "test-model".into(),
            ..Default::default()
        };
        db.save_provider_config(&config).unwrap();
        assert_eq!(db.provider_config().unwrap().model, "test-model");
        let columns: Vec<String> = {
            let conn = db.lock().unwrap();
            let mut stmt = conn.prepare("PRAGMA table_info(provider_configs)").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert!(!columns.iter().any(|c| c.contains("key")));
    }

    #[test]
    fn style_versions_increment() {
        let db = Db::open_in_memory().unwrap();
        let project = db.get_or_create_project("C:\\books", "Books").unwrap();
        let rules = StyleRules {
            tone: "平实".into(),
            ..Default::default()
        };
        let v1 = db.save_style(&project.id, &rules).unwrap();
        let v2 = db.save_style(&project.id, &rules).unwrap();
        assert_eq!((v1.version, v2.version), (1, 2));
        assert_eq!(db.latest_style(&project.id).unwrap().unwrap().version, 2);
    }

    #[test]
    fn documents_are_recent_and_deduplicated_by_path() {
        let db = Db::open_in_memory().unwrap();
        let first = db.upsert_document("C:\\a.md", "a", None).unwrap();
        let second = db.upsert_document("C:\\a.md", "a", None).unwrap();
        assert_eq!(first, second);
        assert_eq!(db.recent_documents(10).unwrap().len(), 1);
    }
}
