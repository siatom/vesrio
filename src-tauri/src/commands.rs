//! Tauri command surface. Every command validates its inputs, maps errors onto
//! the unified `AppError` contract and avoids returning secrets.

use crate::agent::{self, PreparedChat};
use crate::document::scan::FileNode;
use crate::document::{
    display_path, scan_directory, DocumentStore, DocumentView, ExternalChange, SaveOutcome,
    SnapshotStore,
};
use crate::error::{AppError, AppResult};
use crate::platform;
use crate::provider::secrets::SecretStore;
use crate::provider::ProviderClient;
use crate::security::Logger;
use crate::storage::models::{
    Project, ProviderConfig, ProviderConfigView, RecentDocument, SnapshotFile, SnapshotRecord,
    StyleProfile, StyleRules,
};
use crate::storage::{ConversationRecord, Db, MessageRecord};
use crate::suggestion::service::{
    self, ApplyOutcome, PrepareSuggestionInput, PreparedRequest, SuggestionView,
};
use crate::suggestion::SuggestionStatus;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

pub struct AppState {
    pub docs: Mutex<DocumentStore>,
    pub db: Db,
    pub snapshots: SnapshotStore,
    pub secrets: Box<dyn SecretStore>,
    pub cancellations: Mutex<HashMap<String, CancellationToken>>,
    pub logger: Logger,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn initialize(data_dir: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(data_dir).map_err(|e| {
            AppError::io(
                format!("could not create application data folder: {e}"),
                Some(data_dir),
            )
        })?;
        let db = Db::open(&data_dir.join("vesrio.db"))?;
        let snapshots = SnapshotStore::new(data_dir.join("snapshots"));
        snapshots.ensure_ready()?;
        let logger = Logger::new(&data_dir.join("logs"))?;
        Ok(Self {
            docs: Mutex::new(DocumentStore::default()),
            db,
            snapshots,
            secrets: Box::new(crate::provider::KeyringStore::default()),
            cancellations: Mutex::new(HashMap::new()),
            logger,
            data_dir: data_dir.to_path_buf(),
        })
    }

    pub fn log(&self, level: &str, event: &str, fields: Value) {
        self.logger.log(level, event, fields.clone());
        let _ = self.db.insert_audit(level, event, &fields);
    }

    fn docs_lock(&self) -> AppResult<std::sync::MutexGuard<'_, DocumentStore>> {
        self.docs
            .lock()
            .map_err(|_| AppError::internal("document store lock poisoned"))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub data_dir: String,
    pub log_path: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspace {
    pub project: Project,
    pub tree: FileNode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    pub id: String,
    pub path: String,
    pub title: String,
    pub exists: bool,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub host: String,
    pub models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOutcome {
    pub content: String,
    pub safety_snapshot_id: String,
    pub snapshot: SnapshotRecord,
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        name: "Vesrio".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        data_dir: display_path(&state.data_dir),
        log_path: display_path(state.logger.path()),
        platform: platform::label(),
    })
}

#[tauri::command]
pub fn open_document(
    state: State<'_, AppState>,
    path: String,
    project_id: Option<String>,
    convert_encoding: Option<String>,
) -> AppResult<DocumentView> {
    let raw_path = PathBuf::from(&path);
    let canonical = std::fs::canonicalize(&raw_path)
        .map_err(|e| AppError::io(format!("could not open document: {e}"), Some(&raw_path)))?;
    let canonical_label = display_path(&canonical);
    let title = canonical
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());
    let id_hint = state
        .db
        .upsert_document(&canonical_label, &title, project_id.as_deref())?;

    let view = state
        .docs_lock()?
        .open(&canonical, Some(id_hint), convert_encoding.as_deref())?;
    state.log(
        "info",
        "document_opened",
        json!({
            "documentId": view.id,
            "encoding": view.encoding,
            "eol": view.eol,
            "size": view.size,
            "converted": convert_encoding.is_some(),
        }),
    );
    Ok(view)
}

#[tauri::command]
pub fn create_document(
    state: State<'_, AppState>,
    path: String,
    project_id: Option<String>,
) -> AppResult<DocumentView> {
    let target = PathBuf::from(&path);
    crate::document::encoding::ensure_supported_document(&target)?;
    if target.exists() {
        return Err(AppError::invalid("target file already exists"));
    }
    crate::document::atomic_write(&target, b"")?;
    let canonical = std::fs::canonicalize(&target)
        .map_err(|e| AppError::io(format!("could not open new document: {e}"), Some(&target)))?;
    let canonical_label = display_path(&canonical);
    let title = canonical
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());
    let id_hint = state
        .db
        .upsert_document(&canonical_label, &title, project_id.as_deref())?;
    let view = state.docs_lock()?.open(&canonical, Some(id_hint), None)?;
    state.log("info", "document_created", json!({ "documentId": view.id }));
    Ok(view)
}

#[tauri::command]
pub fn convert_document_encoding(
    state: State<'_, AppState>,
    path: String,
    encoding: String,
) -> AppResult<DocumentView> {
    let raw_path = PathBuf::from(&path);
    let canonical = std::fs::canonicalize(&raw_path)
        .map_err(|e| AppError::io(format!("could not open document: {e}"), Some(&raw_path)))?;
    let canonical_label = display_path(&canonical);
    let title = canonical
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".into());
    let id_hint = state.db.upsert_document(&canonical_label, &title, None)?;
    let view = state
        .docs_lock()?
        .open(&canonical, Some(id_hint), Some(&encoding))?;
    state.log(
        "info",
        "document_encoding_converted",
        json!({ "documentId": view.id, "sourceEncoding": encoding }),
    );
    Ok(view)
}

#[tauri::command]
pub fn save_document(
    state: State<'_, AppState>,
    id: String,
    text: String,
    expected_disk_hash: Option<String>,
    force: bool,
) -> AppResult<SaveOutcome> {
    let outcome = state
        .docs_lock()?
        .save(&id, &text, expected_disk_hash.as_deref(), force)?;
    state.log(
        "info",
        "document_saved",
        json!({
            "documentId": id,
            "wrote": outcome.wrote,
            "bytes": outcome.bytes_written,
            "revision": outcome.document.revision,
        }),
    );
    Ok(outcome)
}

#[tauri::command]
pub fn save_document_as(
    state: State<'_, AppState>,
    id: String,
    path: String,
    text: String,
    force: bool,
) -> AppResult<SaveOutcome> {
    let target = PathBuf::from(&path);
    let outcome = state.docs_lock()?.save_as(&id, &target, &text, force)?;
    let view = &outcome.document;
    let _ = state.db.upsert_document(&view.path, &view.title, None)?;
    state.log(
        "info",
        "document_saved_as",
        json!({ "documentId": id, "wrote": outcome.wrote }),
    );
    Ok(outcome)
}

#[tauri::command]
pub fn check_external_change(state: State<'_, AppState>, id: String) -> AppResult<ExternalChange> {
    state.docs_lock()?.check_external(&id)
}

#[tauri::command]
pub fn reload_document(state: State<'_, AppState>, id: String) -> AppResult<DocumentView> {
    let view = state.docs_lock()?.reload(&id)?;
    state.log(
        "info",
        "document_reloaded",
        json!({ "documentId": id, "revision": view.revision }),
    );
    Ok(view)
}

#[tauri::command]
pub fn close_document(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.docs_lock()?.close(&id);
    Ok(())
}

#[tauri::command]
pub fn scan_folder(path: String) -> AppResult<FileNode> {
    scan_directory(Path::new(&path))
}

#[tauri::command]
pub fn open_project(state: State<'_, AppState>, path: String) -> AppResult<ProjectWorkspace> {
    let canonical = std::fs::canonicalize(&path).map_err(|e| {
        AppError::io(
            format!("could not open folder: {e}"),
            Some(Path::new(&path)),
        )
    })?;
    let label = display_path(&canonical);
    let name = canonical
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| label.clone());
    let project = state.db.get_or_create_project(&label, &name)?;
    let tree = scan_directory(&canonical)?;
    state.log("info", "project_opened", json!({ "projectId": project.id }));
    Ok(ProjectWorkspace { project, tree })
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    state.db.list_projects()
}

#[tauri::command]
pub fn list_recent_documents(state: State<'_, AppState>) -> AppResult<Vec<RecentEntry>> {
    let recent = state.db.recent_documents(30)?;
    Ok(recent
        .into_iter()
        .map(|doc: RecentDocument| RecentEntry {
            exists: Path::new(&doc.canonical_path).is_file(),
            id: doc.id,
            path: doc.canonical_path,
            title: doc.title,
            last_opened_at: doc.last_opened_at,
        })
        .collect())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Value> {
    let rows = state.db.all_settings()?;
    let mut map = serde_json::Map::new();
    for (key, value) in rows {
        let parsed = serde_json::from_str(&value).unwrap_or(Value::String(value));
        map.insert(key, parsed);
    }
    Ok(Value::Object(map))
}

fn validate_setting(key: &str, value: &Value) -> AppResult<()> {
    match key {
        "theme" => match value.as_str() {
            Some("system" | "light" | "dark") => Ok(()),
            _ => Err(AppError::invalid("invalid theme value")),
        },
        "editorFont" => match value.as_str() {
            Some("serif" | "sans" | "mono") => Ok(()),
            _ => Err(AppError::invalid("invalid editor font")),
        },
        "fontSize" => match value.as_f64() {
            Some(size) if (12.0..=28.0).contains(&size) => Ok(()),
            _ => Err(AppError::invalid("fontSize must be between 12 and 28")),
        },
        "lineHeight" => match value.as_f64() {
            Some(height) if (1.2..=2.2).contains(&height) => Ok(()),
            _ => Err(AppError::invalid("lineHeight must be between 1.2 and 2.2")),
        },
        "editorWidth" => match value.as_f64() {
            Some(width) if (420.0..=1400.0).contains(&width) => Ok(()),
            _ => Err(AppError::invalid(
                "editorWidth must be between 420 and 1400",
            )),
        },
        "sidebarWidth" => match value.as_f64() {
            Some(width) if (200.0..=480.0).contains(&width) => Ok(()),
            _ => Err(AppError::invalid(
                "sidebarWidth must be between 200 and 480",
            )),
        },
        "inspectorWidth" => match value.as_f64() {
            Some(width) if (260.0..=640.0).contains(&width) => Ok(()),
            _ => Err(AppError::invalid(
                "inspectorWidth must be between 260 and 640",
            )),
        },
        "focusMode" | "reviewMode" | "confirmBeforeSend" | "autoSnapshot" | "typewriterMode"
        | "sidebarOpen" | "outlineOpen" | "inspectorOpen" => {
            if value.is_boolean() {
                Ok(())
            } else {
                Err(AppError::invalid("setting expects a boolean"))
            }
        }
        "inspectorTab" => match value.as_str() {
            Some("outline" | "agent" | "revisions") => Ok(()),
            _ => Err(AppError::invalid("invalid inspector tab")),
        },
        "lastFolder" | "lastDocument" => {
            if value.is_string() {
                Ok(())
            } else {
                Err(AppError::invalid("setting expects a string"))
            }
        }
        _ => Err(AppError::invalid("unknown setting key")),
    }
}

#[tauri::command]
pub fn set_settings(
    state: State<'_, AppState>,
    values: HashMap<String, Value>,
) -> AppResult<Value> {
    for (key, value) in &values {
        validate_setting(key, value)?;
    }
    for (key, value) in values {
        state
            .db
            .set_setting(&key, &serde_json::to_string(&value)?)?;
    }
    get_settings(state)
}

#[tauri::command]
pub fn get_provider_config(state: State<'_, AppState>) -> AppResult<ProviderConfigView> {
    let config = state.db.provider_config()?;
    let (has_api_key, credential_error) = match state.secrets.get() {
        Ok(Some(_)) => (true, None),
        Ok(None) => (false, None),
        Err(error) => (false, Some(error.to_string())),
    };
    Ok(ProviderConfigView {
        base_url: config.base_url,
        model: config.model,
        timeout_ms: config.timeout_ms,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        has_api_key,
        credential_backend: state.secrets.backend().to_string(),
        credential_error,
    })
}

#[tauri::command]
pub fn save_provider_config(
    state: State<'_, AppState>,
    config: ProviderConfig,
    api_key: Option<String>,
    remove_api_key: bool,
) -> AppResult<ProviderConfigView> {
    config.validate()?;
    if let Some(key) = &api_key {
        if key.trim().len() > 4096 {
            return Err(AppError::invalid("API key is too long"));
        }
    }

    // Update the credential store before persisting the config: if the
    // platform backend is unavailable, the user sees the error and the saved
    // provider settings stay unchanged.
    let key_updated = api_key.as_deref().is_some_and(|key| !key.trim().is_empty());
    if let Some(key) = api_key.as_deref().filter(|key| !key.trim().is_empty()) {
        state.secrets.set(key)?;
    }
    if remove_api_key {
        state.secrets.delete()?;
    }
    state.db.save_provider_config(&config)?;
    state.log(
        "info",
        "provider_config_saved",
        json!({
            "model": config.model,
            "host": config.base_url.trim_start_matches("https://").trim_start_matches("http://").split('/').next(),
            "keyUpdated": key_updated,
            "keyRemoved": remove_api_key,
        }),
    );
    get_provider_config(state)
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>) -> AppResult<ProviderTestResult> {
    let config = state.db.provider_config()?;
    let key = state
        .secrets
        .get()?
        .ok_or_else(|| AppError::NotConfigured {
            message: "no API key is configured".into(),
        })?;
    let models = ProviderClient::test_connection(&config, &key).await?;
    let host = config
        .base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or_default()
        .to_string();
    state.log(
        "info",
        "provider_connection_tested",
        json!({ "host": host, "modelCount": models.len() }),
    );
    Ok(ProviderTestResult { host, models })
}

#[tauri::command]
pub fn prepare_suggestion(
    state: State<'_, AppState>,
    input: PrepareSuggestionInput,
) -> AppResult<PreparedRequest> {
    if !state.docs_lock()?.is_open(&input.document_id) {
        return Err(AppError::NotFound {
            id: input.document_id,
        });
    }
    let (prepared, _prompt) = service::prepare(&state.db, input)?;
    state.log(
        "info",
        "suggestion_prepared",
        json!({
            "requestId": prepared.request_id,
            "readScope": prepared.read_scope,
            "outboundChars": prepared.outbound_chars,
            "model": prepared.model,
        }),
    );
    Ok(prepared)
}

#[tauri::command]
pub async fn execute_suggestion(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
) -> AppResult<SuggestionView> {
    let request = state.db.get_request(&request_id)?;
    if let Some(document_id) = &request.document_id {
        if !state.docs_lock()?.is_open(document_id) {
            return Err(AppError::NotFound {
                id: document_id.clone(),
            });
        }
    }
    let token = CancellationToken::new();
    {
        let mut registry = state
            .cancellations
            .lock()
            .map_err(|_| AppError::internal("cancellation registry lock poisoned"))?;
        registry.insert(request_id.clone(), token.clone());
    }
    let result = service::execute(
        &state.db,
        state.secrets.as_ref(),
        &request_id,
        token,
        |delta| {
            let _ = app.emit(
                "ai:delta",
                json!({ "requestId": request_id, "delta": delta }),
            );
        },
    )
    .await;
    if let Ok(mut registry) = state.cancellations.lock() {
        registry.remove(&request_id);
    }
    match result {
        Ok(record) => {
            let view = service::to_view(&state.db, &record)?;
            state.log(
                "info",
                "suggestion_ready",
                json!({
                    "requestId": request_id,
                    "suggestionId": view.id,
                    "warningCount": view.warnings.len(),
                }),
            );
            let _ = app.emit(
                "ai:suggestion",
                json!({ "requestId": request_id, "suggestion": view }),
            );
            Ok(view)
        }
        Err(error) => {
            state.log(
                "warn",
                "suggestion_failed",
                json!({ "requestId": request_id, "code": error.code() }),
            );
            let _ = app.emit(
                "ai:error",
                json!({ "requestId": request_id, "error": error.payload() }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    if let Ok(registry) = state.cancellations.lock() {
        if let Some(token) = registry.get(&request_id) {
            token.cancel();
        }
    }
    state.log(
        "info",
        "request_canceled",
        json!({ "requestId": request_id }),
    );
    Ok(())
}

#[tauri::command]
pub fn reject_suggestion(
    state: State<'_, AppState>,
    suggestion_id: String,
) -> AppResult<SuggestionView> {
    let record = state
        .db
        .transition_suggestion(&suggestion_id, SuggestionStatus::Rejected)?;
    state.log(
        "info",
        "suggestion_rejected",
        json!({ "suggestionId": suggestion_id }),
    );
    service::to_view(&state.db, &record)
}

#[tauri::command]
pub fn mark_suggestion_stale(
    state: State<'_, AppState>,
    suggestion_id: String,
) -> AppResult<SuggestionView> {
    let record = state.db.mark_suggestion_stale(&suggestion_id)?;
    service::to_view(&state.db, &record)
}

#[tauri::command]
pub fn apply_suggestion(
    state: State<'_, AppState>,
    suggestion_id: String,
    document_id: String,
    candidate_index: i64,
    document_text: String,
    edit_revision: i64,
) -> AppResult<ApplyOutcome> {
    if !state.docs_lock()?.is_open(&document_id) {
        return Err(AppError::NotFound {
            id: document_id.clone(),
        });
    }
    let outcome = service::apply(
        &state.db,
        &state.snapshots,
        &document_id,
        &suggestion_id,
        candidate_index,
        &document_text,
        edit_revision,
    )?;
    state.log(
        "info",
        "suggestion_applied",
        json!({
            "suggestionId": suggestion_id,
            "documentId": document_id,
            "snapshotId": outcome.snapshot_id,
            "alreadyApplied": outcome.already_applied,
        }),
    );
    Ok(outcome)
}

#[tauri::command]
pub fn list_suggestions(
    state: State<'_, AppState>,
    document_id: String,
) -> AppResult<Vec<SuggestionView>> {
    let records = state.db.list_suggestions(&document_id, 50)?;
    records
        .iter()
        .map(|record| service::to_view(&state.db, record))
        .collect()
}

#[tauri::command]
pub fn prepare_chat(
    state: State<'_, AppState>,
    input: agent::PrepareChatInput,
) -> AppResult<PreparedChat> {
    if !state.docs_lock()?.is_open(&input.document_id) {
        return Err(AppError::NotFound {
            id: input.document_id,
        });
    }
    let prepared = agent::prepare(&state.db, input)?;
    state.log(
        "info",
        "chat_prepared",
        json!({
            "requestId": prepared.request_id,
            "conversationId": prepared.conversation_id,
            "outboundChars": prepared.outbound_chars,
            "readScope": prepared.read_scope,
        }),
    );
    Ok(prepared)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResult {
    pub message: MessageRecord,
    pub conversation_id: String,
}

#[tauri::command]
pub async fn execute_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    document_text: String,
) -> AppResult<ChatResult> {
    let request = state.db.get_request(&request_id)?;
    if let Some(document_id) = &request.document_id {
        if !state.docs_lock()?.is_open(document_id) {
            return Err(AppError::NotFound {
                id: document_id.clone(),
            });
        }
    }
    let token = CancellationToken::new();
    {
        let mut registry = state
            .cancellations
            .lock()
            .map_err(|_| AppError::internal("cancellation registry lock poisoned"))?;
        registry.insert(request_id.clone(), token.clone());
    }
    let result = agent::execute(
        &state.db,
        state.secrets.as_ref(),
        &request_id,
        &document_text,
        token,
        |delta| {
            let _ = app.emit(
                "ai:chat-delta",
                json!({ "requestId": request_id, "delta": delta }),
            );
        },
    )
    .await;
    if let Ok(mut registry) = state.cancellations.lock() {
        registry.remove(&request_id);
    }
    match result {
        Ok(outcome) => {
            state.log(
                "info",
                "chat_completed",
                json!({
                    "requestId": request_id,
                    "conversationId": outcome.conversation_id,
                    "citationCount": outcome.citations.len(),
                }),
            );
            let _ = app.emit(
                "ai:chat-done",
                json!({
                    "requestId": request_id,
                    "message": outcome.message,
                    "citations": outcome.citations,
                }),
            );
            Ok(ChatResult {
                message: outcome.message,
                conversation_id: outcome.conversation_id,
            })
        }
        Err(error) => {
            state.log(
                "warn",
                "chat_failed",
                json!({ "requestId": request_id, "code": error.code() }),
            );
            let _ = app.emit(
                "ai:chat-error",
                json!({ "requestId": request_id, "error": error.payload() }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<MessageRecord>> {
    agent::history(&state.db, &conversation_id)
}

#[tauri::command]
pub fn list_conversations(
    state: State<'_, AppState>,
    document_id: String,
) -> AppResult<Vec<ConversationRecord>> {
    state.db.list_conversations(&document_id)
}

#[tauri::command]
pub fn create_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    content: String,
    source: String,
) -> AppResult<SnapshotRecord> {
    if !matches!(
        source.as_str(),
        "manual" | "before_restore" | "conflict" | "ai_apply"
    ) {
        return Err(AppError::invalid("unsupported snapshot source"));
    }
    let record = state
        .snapshots
        .create(&state.db, &document_id, &content, &source)?;
    state.log(
        "info",
        "snapshot_created",
        json!({ "documentId": document_id, "snapshotId": record.id, "source": record.source }),
    );
    Ok(record)
}

#[tauri::command]
pub fn list_snapshots(
    state: State<'_, AppState>,
    document_id: String,
) -> AppResult<Vec<SnapshotRecord>> {
    state.db.list_snapshots(&document_id, 100)
}

#[tauri::command]
pub fn read_snapshot(state: State<'_, AppState>, snapshot_id: String) -> AppResult<SnapshotFile> {
    state.snapshots.read(&state.db, &snapshot_id)
}

#[tauri::command]
pub fn restore_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
    current_text: String,
) -> AppResult<RestoreOutcome> {
    let snapshot = state.snapshots.read(&state.db, &snapshot_id)?;
    let safety = state.snapshots.create(
        &state.db,
        &snapshot.record.document_id,
        &current_text,
        "before_restore",
    )?;
    state.log(
        "info",
        "snapshot_restored",
        json!({
            "documentId": snapshot.record.document_id,
            "snapshotId": snapshot_id,
            "safetySnapshotId": safety.id,
        }),
    );
    Ok(RestoreOutcome {
        content: snapshot.content,
        safety_snapshot_id: safety.id,
        snapshot: snapshot.record,
    })
}

#[tauri::command]
pub fn get_style_profile(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<StyleProfile> {
    if let Some(profile) = state.db.latest_style(&project_id)? {
        return Ok(profile);
    }
    Ok(StyleProfile {
        id: "default".into(),
        project_id,
        version: 0,
        rules: StyleRules::default(),
        created_at: String::new(),
    })
}

#[tauri::command]
pub fn save_style_profile(
    state: State<'_, AppState>,
    project_id: String,
    rules: StyleRules,
) -> AppResult<StyleProfile> {
    if rules.audience.chars().count() > 500
        || rules.tone.chars().count() > 500
        || rules.notes.chars().count() > 4000
        || rules.banned.len() > 100
        || rules.terminology.len() > 200
    {
        return Err(AppError::invalid("style profile exceeds the size limits"));
    }
    let profile = state.db.save_style(&project_id, &rules)?;
    state.log(
        "info",
        "style_profile_saved",
        json!({ "projectId": project_id, "version": profile.version }),
    );
    Ok(profile)
}

#[tauri::command]
pub fn report_client_event(
    state: State<'_, AppState>,
    level: String,
    event: String,
    fields: Value,
) -> AppResult<()> {
    let level = match level.as_str() {
        "info" | "warn" | "error" => level,
        _ => "info".to_string(),
    };
    state.log(&level, &event, fields);
    Ok(())
}

#[tauri::command]
pub fn get_conversation(
    state: State<'_, AppState>,
    document_id: String,
    project_id: Option<String>,
) -> AppResult<ConversationRecord> {
    agent::conversation_for_document(&state.db, &document_id, project_id.as_deref())
}

#[tauri::command]
pub fn debug_paths(state: State<'_, AppState>) -> AppResult<Value> {
    Ok(json!({
        "dataDir": display_path(&state.data_dir),
        "snapshotRoot": display_path(&state.data_dir.join("snapshots")),
        "database": display_path(&state.data_dir.join("vesrio.db")),
        "app": state
            .data_dir
            .parent()
            .map(display_path)
            .unwrap_or_default(),
    }))
}

/// Report the app-drawn maximize button rectangle so the native hit test can
/// expose it as `HTMAXBUTTON` and let Windows 11 offer Snap Layouts on hover.
///
/// `rect` is in CSS pixels relative to the client area; `None` clears it.
#[tauri::command]
pub fn set_caption_button_rect(rect: Option<crate::window_chrome::CaptionRect>) {
    crate::window_chrome::set_maximize_button_rect(rect);
}
