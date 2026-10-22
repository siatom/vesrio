//! Snapshot files live under the app data directory only. A snapshot is
//! created before a risky operation (AI apply, manual checkpoint, reload after
//! an external conflict) and can be restored after a restart.

use crate::document::encoding::sha256_text;
use crate::error::{AppError, AppResult};
use crate::storage::models::{SnapshotFile, SnapshotRecord};
use crate::storage::Db;
use chrono::{DateTime, Utc};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_PER_DOCUMENT: usize = 100;

pub struct SnapshotStore {
    root: PathBuf,
}

impl SnapshotStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn ensure_ready(&self) -> AppResult<()> {
        fs::create_dir_all(&self.root).map_err(|e| {
            AppError::io(
                format!("could not create snapshot directory: {e}"),
                Some(&self.root),
            )
        })
    }

    pub fn create(
        &self,
        db: &Db,
        document_id: &str,
        content: &str,
        source: &str,
    ) -> AppResult<SnapshotRecord> {
        self.ensure_ready()?;
        let safe_document: String = document_id
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        let directory = self.root.join(if safe_document.is_empty() {
            "unknown".to_string()
        } else {
            safe_document
        });
        fs::create_dir_all(&directory).map_err(|e| {
            AppError::io(
                format!("could not create snapshot folder: {e}"),
                Some(&directory),
            )
        })?;

        let id = uuid::Uuid::new_v4().to_string();
        let bytes = content.as_bytes();
        let record = SnapshotRecord {
            id: id.clone(),
            document_id: document_id.to_string(),
            content_hash: sha256_text(content),
            source: source.to_string(),
            size_bytes: bytes.len() as u64,
            created_at: Utc::now().to_rfc3339(),
        };
        let path = directory.join(format!("{id}.md"));
        fs::write(&path, bytes)
            .map_err(|e| AppError::io(format!("could not write snapshot: {e}"), Some(&path)))?;
        if let Err(error) = db.insert_snapshot(&record, &path) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        self.prune(db, document_id);
        Ok(record)
    }

    pub fn read(&self, db: &Db, snapshot_id: &str) -> AppResult<SnapshotFile> {
        let (record, path) = db.get_snapshot(snapshot_id)?;
        let content = fs::read_to_string(&path)
            .map_err(|e| AppError::io(format!("could not read snapshot: {e}"), Some(&path)))?;
        if sha256_text(&content) != record.content_hash {
            return Err(AppError::invalid(
                "snapshot content does not match its recorded hash",
            ));
        }
        Ok(SnapshotFile { record, content })
    }

    fn prune(&self, db: &Db, document_id: &str) {
        let Ok(overflow) = db.snapshot_overflow(document_id, MAX_PER_DOCUMENT) else {
            return;
        };
        for record in overflow {
            if let Ok((_, path)) = db.get_snapshot(&record.id) {
                if self.is_inside_root(&path) {
                    let _ = fs::remove_file(&path);
                }
            }
            let _ = db.delete_snapshot(&record.id);
        }
    }

    fn is_inside_root(&self, path: &Path) -> bool {
        let Ok(root) = fs::canonicalize(&self.root) else {
            return false;
        };
        let Ok(candidate) = fs::canonicalize(path) else {
            return false;
        };
        candidate.starts_with(root)
    }

    /// Human-readable age used by the revision panel.
    pub fn describe(record: &SnapshotRecord) -> String {
        DateTime::parse_from_rfc3339(&record.created_at)
            .map(|time| {
                time.with_timezone(&Utc)
                    .format("%Y-%m-%d %H:%M")
                    .to_string()
            })
            .unwrap_or_else(|_| record.created_at.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Db, SnapshotStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open_in_memory().unwrap();
        let store = SnapshotStore::new(dir.path().join("snapshots"));
        (dir, db, store)
    }

    #[test]
    fn creates_and_reads_verified_snapshot() {
        let (_dir, db, store) = setup();
        let record = store.create(&db, "doc-1", "正文内容\n", "manual").unwrap();
        let file = store.read(&db, &record.id).unwrap();
        assert_eq!(file.content, "正文内容\n");
        assert_eq!(file.record.content_hash, sha256_text("正文内容\n"));
        let list = db.list_snapshots("doc-1", 10).unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn detects_tampered_snapshot() {
        let (_dir, db, store) = setup();
        let record = store.create(&db, "doc-1", "原文", "manual").unwrap();
        let (_, path) = db.get_snapshot(&record.id).unwrap();
        fs::write(path, "篡改").unwrap();
        assert!(store.read(&db, &record.id).is_err());
    }

    #[test]
    fn document_ids_cannot_escape_snapshot_root() {
        let (_dir, db, store) = setup();
        let record = store.create(&db, "../../evil", "x", "manual").unwrap();
        let (_, path) = db.get_snapshot(&record.id).unwrap();
        assert!(
            path.starts_with(store.root.join("evil"))
                || path.starts_with(store.root.join("..evil"))
        );
        assert!(!path.to_string_lossy().contains("..\\"));
    }
}
