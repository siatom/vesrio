//! Suggestion preparation, generation and the restricted apply service.

use super::anchor::{capture_anchor, compute_apply, paragraph_range, slice_utf16, SelectionAnchor};
use crate::document::snapshot::SnapshotStore;
use crate::error::{AppError, AppResult};
use crate::provider::secrets::SecretStore;
use crate::provider::{ChatMessage, ProviderClient};
use crate::storage::models::{StyleProfile, StyleRules};
use crate::storage::{
    CandidateRecord, Db, NewRequest, NewSuggestion, RequestRecord, SuggestionRecord,
};
use crate::suggestion::prompt::{
    build_suggestion_messages, split_candidates, validate_candidate, SuggestionPromptInput,
};
use crate::suggestion::state::{RequestStatus, SuggestionStatus};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const MAX_DOCUMENT_CONTEXT_CHARS: usize = 120_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSuggestionInput {
    pub document_id: String,
    pub project_id: Option<String>,
    pub document_title: String,
    pub document_text: String,
    pub instruction: String,
    pub intent: String,
    pub candidate_count: usize,
    pub read_scope: String,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub selected_text_sha256: Option<String>,
    pub edit_revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRequest {
    pub request_id: String,
    pub messages: Vec<ChatMessage>,
    pub outbound_chars: usize,
    pub read_scope: String,
    pub write_scope: String,
    pub model: String,
    pub provider_host: String,
    pub base_revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSuggestionPayload {
    messages: Vec<ChatMessage>,
    anchor: SelectionAnchor,
    original_text: String,
    instruction: String,
    candidate_count: usize,
    style: StyleRules,
    read_scope: String,
    document_title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionView {
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
    pub candidates: Vec<CandidateRecord>,
    pub base_revision: i64,
    pub snapshot_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub suggestion: SuggestionView,
    pub new_text: String,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub snapshot_id: String,
    pub already_applied: bool,
}

fn validate_read_scope(scope: &str) -> AppResult<()> {
    match scope {
        "selection" | "selection_with_paragraph_context" | "document" => Ok(()),
        _ => Err(AppError::invalid("unsupported read scope")),
    }
}

pub fn latest_style(db: &Db, project_id: Option<&str>) -> AppResult<(StyleProfile, StyleRules)> {
    if let Some(project_id) = project_id {
        if let Some(profile) = db.latest_style(project_id)? {
            let rules = profile.rules.clone();
            return Ok((profile, rules));
        }
    }
    Ok((
        StyleProfile {
            id: "default".into(),
            project_id: project_id.unwrap_or("default").to_string(),
            version: 0,
            rules: StyleRules::default(),
            created_at: String::new(),
        },
        StyleRules::default(),
    ))
}

pub fn build_context(
    document_text: &str,
    from: usize,
    to: usize,
    scope: &str,
) -> AppResult<String> {
    match scope {
        "selection" => {
            let anchor = capture_anchor(document_text, from, to)?;
            Ok(format!(
                "{}[[选区]]{}",
                anchor.context_before, anchor.context_after
            ))
        }
        "selection_with_paragraph_context" => {
            let (start, end) = paragraph_range(document_text, from, to)?;
            Ok(slice_utf16(document_text, start, end)?.to_string())
        }
        "document" => {
            let total = document_text.chars().count();
            if total <= MAX_DOCUMENT_CONTEXT_CHARS {
                Ok(document_text.to_string())
            } else {
                let truncated: String = document_text
                    .chars()
                    .take(MAX_DOCUMENT_CONTEXT_CHARS)
                    .collect();
                Ok(format!(
                    "{truncated}\n\n[全文过长，仅发送前 {MAX_DOCUMENT_CONTEXT_CHARS} 字，共 {total} 字]"
                ))
            }
        }
        _ => Err(AppError::invalid("unsupported read scope")),
    }
}

pub fn prepare(
    db: &Db,
    input: PrepareSuggestionInput,
) -> AppResult<(PreparedRequest, SuggestionPromptInput)> {
    validate_read_scope(&input.read_scope)?;
    if input.instruction.trim().is_empty() {
        return Err(AppError::invalid("instruction must not be empty"));
    }
    if input.instruction.chars().count() > 2000 {
        return Err(AppError::invalid("instruction is too long"));
    }
    let anchor = capture_anchor(&input.document_text, input.from_utf16, input.to_utf16)?;
    if let Some(expected) = &input.selected_text_sha256 {
        if expected != &anchor.selected_text_sha256 {
            return Err(AppError::Stale {
                reason: "the selection changed before the request could be prepared".into(),
            });
        }
    }
    let selected_text = slice_utf16(&input.document_text, input.from_utf16, input.to_utf16)?;
    if selected_text.trim().is_empty() {
        return Err(AppError::invalid(
            "select some text before requesting a suggestion",
        ));
    }

    let (_profile, style) = latest_style(db, input.project_id.as_deref())?;
    let context = build_context(
        &input.document_text,
        input.from_utf16,
        input.to_utf16,
        &input.read_scope,
    )?;
    let prompt_input = SuggestionPromptInput {
        document_title: input.document_title.clone(),
        instruction: input.instruction.clone(),
        selected_text: selected_text.to_string(),
        context,
        read_scope: input.read_scope.clone(),
        style: style.clone(),
        candidate_count: input.candidate_count,
    };
    let messages = build_suggestion_messages(&prompt_input);
    let outbound_chars = messages.iter().map(|m| m.content.chars().count()).sum();

    let config = db.provider_config()?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let payload = StoredSuggestionPayload {
        messages: messages.clone(),
        anchor: anchor.clone(),
        original_text: selected_text.to_string(),
        instruction: input.instruction.clone(),
        candidate_count: input.candidate_count.clamp(1, 3),
        style,
        read_scope: input.read_scope.clone(),
        document_title: input.document_title.clone(),
    };
    db.create_request(&NewRequest {
        id: request_id.clone(),
        document_id: Some(input.document_id.clone()),
        project_id: input.project_id.clone(),
        kind: "suggestion".into(),
        intent: input.intent.clone(),
        read_scope: input.read_scope.clone(),
        write_scope: "selection_only".into(),
        base_revision: input.edit_revision,
        payload: serde_json::to_value(&payload)?,
    })?;

    Ok((
        PreparedRequest {
            request_id,
            messages,
            outbound_chars,
            read_scope: input.read_scope,
            write_scope: "selection_only".into(),
            model: config.model,
            provider_host: provider_host(&config.base_url),
            base_revision: input.edit_revision,
        },
        prompt_input,
    ))
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

fn stored_payload(request: &RequestRecord) -> AppResult<StoredSuggestionPayload> {
    serde_json::from_value(request.payload.clone())
        .map_err(|_| AppError::internal("stored request payload is invalid"))
}

pub async fn execute<F>(
    db: &Db,
    secrets: &dyn SecretStore,
    request_id: &str,
    cancel: CancellationToken,
    mut on_delta: F,
) -> AppResult<SuggestionRecord>
where
    F: FnMut(&str),
{
    let request = db.get_request(request_id)?;
    if request.kind != "suggestion" {
        return Err(AppError::invalid("request is not a suggestion request"));
    }
    if request.status != RequestStatus::Prepared {
        return Err(AppError::InvalidTransition {
            from: request.status.as_str().to_string(),
            to: RequestStatus::Generating.as_str().to_string(),
        });
    }
    let payload = stored_payload(&request)?;
    if request.write_scope != "selection_only" {
        return Err(AppError::invalid(
            "suggestion requests must have selection-only write scope",
        ));
    }
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
    let result =
        ProviderClient::stream_chat(&config, &key, payload.messages.clone(), cancel, |delta| {
            on_delta(delta)
        })
        .await;

    match result {
        Ok(raw) => {
            let candidates = split_candidates(&raw, payload.candidate_count);
            if candidates.is_empty() {
                let _ = db.update_request_status(
                    request_id,
                    RequestStatus::Failed,
                    Some(("invalid_output", "the model returned no usable text")),
                );
                return Err(AppError::provider(
                    "the model returned no usable text",
                    true,
                    None,
                ));
            }
            for candidate in &candidates {
                if candidate.chars().count() > 8000 {
                    let _ = db.update_request_status(
                        request_id,
                        RequestStatus::Failed,
                        Some(("invalid_output", "candidate exceeded the safe length")),
                    );
                    return Err(AppError::provider(
                        "the model returned an over-long candidate",
                        false,
                        None,
                    ));
                }
            }
            let primary = candidates[0].clone();
            let warnings = validate_candidate(&primary, &payload.original_text, &payload.style);
            let rationale = if payload.instruction.trim().is_empty() {
                "根据你的指令生成".to_string()
            } else {
                format!("根据指令「{}」生成", truncate(&payload.instruction, 60))
            };
            let suggestion_id = uuid::Uuid::new_v4().to_string();
            let candidate_records = candidates
                .iter()
                .enumerate()
                .map(|(idx, text)| CandidateRecord {
                    idx: idx as i64,
                    candidate_text: text.clone(),
                    rationale: rationale.clone(),
                })
                .collect::<Vec<_>>();
            db.insert_suggestion(&NewSuggestion {
                id: suggestion_id.clone(),
                request_id: request_id.to_string(),
                document_id: request
                    .document_id
                    .clone()
                    .ok_or_else(|| AppError::internal("suggestion request has no document"))?,
                from_utf16: payload.anchor.from_utf16 as i64,
                to_utf16: payload.anchor.to_utf16 as i64,
                selected_text_hash: payload.anchor.selected_text_sha256.clone(),
                original_text: payload.original_text.clone(),
                candidate_text: primary,
                rationale,
                warnings,
                candidates: candidate_records,
            })?;
            db.update_request_status(request_id, RequestStatus::Completed, None)?;
            db.get_suggestion(&suggestion_id)
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

fn truncate(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(max).collect();
        format!("{cut}…")
    }
}

pub fn to_view(db: &Db, record: &SuggestionRecord) -> AppResult<SuggestionView> {
    let base_revision = db
        .get_request(&record.request_id)
        .map(|request| request.base_revision)
        .unwrap_or(0);
    Ok(SuggestionView {
        id: record.id.clone(),
        request_id: record.request_id.clone(),
        document_id: record.document_id.clone(),
        from_utf16: record.from_utf16,
        to_utf16: record.to_utf16,
        selected_text_hash: record.selected_text_hash.clone(),
        original_text: record.original_text.clone(),
        candidate_text: record.candidate_text.clone(),
        rationale: record.rationale.clone(),
        warnings: record.warnings.clone(),
        status: record.status,
        selected_candidate: record.selected_candidate,
        candidates: record.candidates.clone(),
        base_revision,
        snapshot_id: record.snapshot_id.clone(),
        created_at: record.created_at.clone(),
    })
}

pub fn apply(
    db: &Db,
    snapshots: &SnapshotStore,
    document_id: &str,
    suggestion_id: &str,
    candidate_index: i64,
    document_text: &str,
    edit_revision: i64,
) -> AppResult<ApplyOutcome> {
    let suggestion = db.get_suggestion(suggestion_id)?;
    if suggestion.document_id != document_id {
        return Err(AppError::invalid(
            "suggestion does not belong to the requested document",
        ));
    }
    let request = db.get_request(&suggestion.request_id)?;

    if suggestion.status == SuggestionStatus::Accepted {
        let snapshot_id = suggestion
            .snapshot_id
            .clone()
            .ok_or_else(|| AppError::internal("accepted suggestion has no snapshot"))?;
        return Ok(ApplyOutcome {
            suggestion: to_view(db, &suggestion)?,
            new_text: document_text.to_string(),
            from_utf16: suggestion.applied_from_utf16.unwrap_or(0) as usize,
            to_utf16: suggestion.applied_to_utf16.unwrap_or(0) as usize,
            snapshot_id,
            already_applied: true,
        });
    }

    if suggestion.status == SuggestionStatus::Stale {
        return Err(AppError::Stale {
            reason: "this suggestion was marked stale and cannot be applied".into(),
        });
    }
    if suggestion.status != SuggestionStatus::Ready {
        return Err(AppError::InvalidTransition {
            from: suggestion.status.as_str().to_string(),
            to: SuggestionStatus::Accepted.as_str().to_string(),
        });
    }
    if request.base_revision != edit_revision {
        let _ = db.mark_suggestion_stale(suggestion_id);
        return Err(AppError::Stale {
            reason: "the document changed after this suggestion was requested".into(),
        });
    }

    let candidate = suggestion
        .candidates
        .iter()
        .find(|c| c.idx == candidate_index)
        .map(|c| c.candidate_text.clone())
        .ok_or_else(|| AppError::invalid("candidate index does not exist"))?;

    let computation = match compute_apply(
        document_text,
        suggestion.from_utf16 as usize,
        suggestion.to_utf16 as usize,
        &suggestion.selected_text_hash,
        &candidate,
    ) {
        Ok(value) => value,
        Err(error) if error.code() == "stale_suggestion" => {
            let _ = db.mark_suggestion_stale(suggestion_id);
            return Err(error);
        }
        Err(error) => return Err(error),
    };

    let snapshot = snapshots.create(db, &suggestion.document_id, document_text, "ai_apply")?;
    let applied = db.mark_suggestion_applied(
        suggestion_id,
        candidate_index,
        computation.from_utf16 as i64,
        computation.to_utf16 as i64,
        &computation.applied_text_hash,
        &snapshot.id,
    )?;

    Ok(ApplyOutcome {
        suggestion: to_view(db, &applied)?,
        new_text: computation.new_text,
        from_utf16: computation.from_utf16,
        to_utf16: computation.to_utf16,
        snapshot_id: snapshot.id,
        already_applied: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::sha256_text;

    fn db_with_project() -> (Db, String) {
        let db = Db::open_in_memory().unwrap();
        let project = db.get_or_create_project("C:\\book", "book").unwrap();
        (db, project.id)
    }

    fn prepare_fixture(db: &Db, project_id: &str, text: &str) -> PreparedRequest {
        let from = 0;
        let to = text.chars().count();
        // Chinese characters are 1 UTF-16 unit each in this fixture.
        let (request, _) = prepare(
            db,
            PrepareSuggestionInput {
                document_id: "doc-1".into(),
                project_id: Some(project_id.into()),
                document_title: "标题".into(),
                document_text: text.into(),
                instruction: "精简".into(),
                intent: "shorten".into(),
                candidate_count: 1,
                read_scope: "selection".into(),
                from_utf16: from,
                to_utf16: to,
                selected_text_sha256: None,
                edit_revision: 4,
            },
        )
        .unwrap();
        request
    }

    fn ready_suggestion(db: &Db, project_id: &str, text: &str) -> SuggestionRecord {
        let request = prepare_fixture(db, project_id, text);
        db.insert_suggestion(&NewSuggestion {
            id: "s-1".into(),
            request_id: request.request_id.clone(),
            document_id: "doc-1".into(),
            from_utf16: 0,
            to_utf16: text.chars().count() as i64,
            selected_text_hash: sha256_text(text),
            original_text: text.into(),
            candidate_text: "候选文本".into(),
            rationale: "理由".into(),
            warnings: vec![],
            candidates: vec![
                CandidateRecord {
                    idx: 0,
                    candidate_text: "候选文本".into(),
                    rationale: "理由".into(),
                },
                CandidateRecord {
                    idx: 1,
                    candidate_text: "备选文本".into(),
                    rationale: "理由".into(),
                },
            ],
        })
        .unwrap();
        db.update_request_status(&request.request_id, RequestStatus::Generating, None)
            .unwrap();
        db.update_request_status(&request.request_id, RequestStatus::Completed, None)
            .unwrap();
        db.get_suggestion("s-1").unwrap()
    }

    #[test]
    fn prepare_always_uses_selection_only_write_scope() {
        let (db, project) = db_with_project();
        let request = prepare_fixture(&db, &project, "原文");
        assert_eq!(request.write_scope, "selection_only");
        let stored = db.get_request(&request.request_id).unwrap();
        assert_eq!(stored.status, RequestStatus::Prepared);
        assert_eq!(stored.write_scope, "selection_only");
    }

    #[test]
    fn prepare_rejects_tampered_selection_hash() {
        let (db, project) = db_with_project();
        let err = prepare(
            &db,
            PrepareSuggestionInput {
                document_id: "doc-1".into(),
                project_id: Some(project),
                document_title: "标题".into(),
                document_text: "原文".into(),
                instruction: "精简".into(),
                intent: "shorten".into(),
                candidate_count: 1,
                read_scope: "selection".into(),
                from_utf16: 0,
                to_utf16: 2,
                selected_text_sha256: Some(sha256_text("其他")),
                edit_revision: 1,
            },
        )
        .unwrap_err();
        assert_eq!(err.code(), "stale_suggestion");
    }

    #[test]
    fn apply_marks_stale_after_revision_change() {
        let (db, project) = db_with_project();
        let snapshots = SnapshotStore::new(tempfile::tempdir().unwrap().keep().join("snapshots"));
        ready_suggestion(&db, &project, "原文");
        let err = apply(
            &db, &snapshots, "doc-1", "s-1", 0, "原文", 5, // prepare used revision 4
        )
        .unwrap_err();
        assert_eq!(err.code(), "stale_suggestion");
        assert_eq!(
            db.get_suggestion("s-1").unwrap().status,
            SuggestionStatus::Stale
        );
    }

    #[test]
    fn apply_marks_stale_when_selected_text_changed() {
        let (db, project) = db_with_project();
        let snapshots = SnapshotStore::new(tempfile::tempdir().unwrap().keep().join("snapshots"));
        ready_suggestion(&db, &project, "原文");
        let err = apply(&db, &snapshots, "doc-1", "s-1", 0, "改过的原文", 4).unwrap_err();
        assert_eq!(err.code(), "stale_suggestion");
        assert_eq!(
            db.get_suggestion("s-1").unwrap().status,
            SuggestionStatus::Stale
        );
    }

    #[test]
    fn apply_changes_only_the_selected_range_and_creates_snapshot() {
        let (db, project) = db_with_project();
        let dir = tempfile::tempdir().unwrap();
        let snapshots = SnapshotStore::new(dir.path().join("snapshots"));
        ready_suggestion(&db, &project, "原文");
        let outcome = apply(&db, &snapshots, "doc-1", "s-1", 1, "原文", 4).unwrap();
        assert_eq!(outcome.new_text, "备选文本");
        assert!(!outcome.already_applied);
        assert_eq!(outcome.snapshot_id.len(), 36);
        let snapshot = snapshots.read(&db, &outcome.snapshot_id).unwrap();
        assert_eq!(snapshot.content, "原文");
        assert_eq!(outcome.to_utf16, "备选文本".chars().count());
    }

    #[test]
    fn repeated_apply_is_idempotent() {
        let (db, project) = db_with_project();
        let dir = tempfile::tempdir().unwrap();
        let snapshots = SnapshotStore::new(dir.path().join("snapshots"));
        ready_suggestion(&db, &project, "原文");
        let first = apply(&db, &snapshots, "doc-1", "s-1", 0, "原文", 4).unwrap();
        let second = apply(&db, &snapshots, "doc-1", "s-1", 0, &first.new_text, 4).unwrap();
        assert!(second.already_applied);
        assert_eq!(second.new_text, first.new_text);
        assert_eq!(second.snapshot_id, first.snapshot_id);
        assert_eq!(db.list_snapshots("doc-1", 10).unwrap().len(), 1);
    }

    #[test]
    fn context_scope_is_clamped() {
        let text = "甲".repeat(MAX_DOCUMENT_CONTEXT_CHARS + 10);
        let context = build_context(&text, 0, 1, "document").unwrap();
        assert!(context.chars().count() < MAX_DOCUMENT_CONTEXT_CHARS + 100);
        assert!(context.contains("仅发送前"));
    }

    async fn fake_server(response: String) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;
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

    #[tokio::test]
    async fn provider_failure_creates_no_suggestion_and_no_document_change() {
        use crate::provider::secrets::MemoryStore;
        let (db, project) = db_with_project();
        let request = prepare_fixture(&db, &project, "原文");
        let body = "{\"error\":{\"message\":\"upstream exploded\"}}";
        let response = format!(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let base = fake_server(response).await;
        db.save_provider_config(&crate::storage::models::ProviderConfig {
            base_url: base,
            ..Default::default()
        })
        .unwrap();
        let secrets = MemoryStore::default();
        secrets.set("test-key").unwrap();

        let error = execute(
            &db,
            &secrets,
            &request.request_id,
            CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error.code(), "provider_error");
        assert!(db.list_suggestions("doc-1", 10).unwrap().is_empty());
        assert_eq!(
            db.get_request(&request.request_id).unwrap().status,
            RequestStatus::Failed
        );
    }

    #[tokio::test]
    async fn canceled_request_never_persists_a_suggestion() {
        use crate::provider::secrets::MemoryStore;
        let (db, project) = db_with_project();
        let request = prepare_fixture(&db, &project, "原文");
        let secrets = MemoryStore::default();
        secrets.set("test-key").unwrap();
        let token = CancellationToken::new();
        token.cancel();
        let error = execute(&db, &secrets, &request.request_id, token, |_| {})
            .await
            .unwrap_err();
        assert_eq!(error.code(), "cancelled");
        assert!(db.list_suggestions("doc-1", 10).unwrap().is_empty());
        assert_eq!(
            db.get_request(&request.request_id).unwrap().status,
            RequestStatus::Canceled
        );
    }
}
