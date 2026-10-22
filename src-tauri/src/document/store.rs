//! In-memory registry of open documents plus the save contract.

use super::atomic::atomic_write;
use super::encoding::{
    decode, encode, ensure_supported_document, normalize_eol, sha256_hex, sha256_text,
    DecodedDocument, Encoding, Eol, MAX_DOCUMENT_BYTES,
};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
    pub id: String,
    pub path: String,
    pub title: String,
    /// LF-normalized text used by the editor.
    pub text: String,
    pub encoding: String,
    pub eol: String,
    pub bom: bool,
    pub disk_hash: String,
    pub content_hash: String,
    pub revision: u64,
    pub size: u64,
    pub modified_ms: Option<i64>,
    pub read_only: bool,
    pub written: bool,
    pub warnings: Vec<DocumentWarning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub document: DocumentView,
    pub wrote: bool,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    pub changed: bool,
    pub known_hash: String,
    pub disk_hash: Option<String>,
    pub disk_size: Option<u64>,
}

#[derive(Debug, Clone)]
struct OpenDocument {
    id: String,
    path: PathBuf,
    text: String,
    original_text: String,
    original_raw: Vec<u8>,
    encoding: Encoding,
    eol: Eol,
    save_eol: &'static str,
    disk_hash: String,
    revision: u64,
    converted_from: Option<String>,
    size: u64,
    read_only: bool,
    modified_ms: Option<i64>,
}

#[derive(Default)]
pub struct DocumentStore {
    docs: HashMap<String, OpenDocument>,
}

pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }
    value.to_string()
}

fn modified_ms(metadata: &fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
}

fn read_raw(path: &Path) -> AppResult<(Vec<u8>, fs::Metadata)> {
    let metadata = fs::metadata(path)
        .map_err(|e| AppError::io(format!("could not read file metadata: {e}"), Some(path)))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::invalid(format!(
            "file is larger than the {} MB limit",
            MAX_DOCUMENT_BYTES / 1024 / 1024
        )));
    }
    let bytes = fs::read(path)
        .map_err(|e| AppError::io(format!("could not read file: {e}"), Some(path)))?;
    Ok((bytes, metadata))
}

impl DocumentStore {
    pub fn open(
        &mut self,
        path: &Path,
        id_hint: Option<String>,
        convert_with: Option<&str>,
    ) -> AppResult<DocumentView> {
        ensure_supported_document(path)?;
        let canonical = fs::canonicalize(path)
            .map_err(|e| AppError::io(format!("could not resolve path: {e}"), Some(path)))?;

        if let Some(existing) = self
            .docs
            .values()
            .find(|doc| doc.path == canonical)
            .map(|doc| doc.id.clone())
        {
            return self.view(&existing);
        }

        let (bytes, metadata) = read_raw(&canonical)?;
        let decoded = decode(bytes, convert_with)?;
        let size = metadata.len();
        let read_only = metadata.permissions().readonly();
        let modified = modified_ms(&metadata);
        let id = id_hint.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let doc = OpenDocument::from_decoded(id, canonical, decoded, size, read_only, modified);
        let view = doc.view(false);
        self.docs.insert(doc.id.clone(), doc);
        Ok(view)
    }

    pub fn is_open(&self, id: &str) -> bool {
        self.docs.contains_key(id)
    }

    pub fn view(&self, id: &str) -> AppResult<DocumentView> {
        self.docs
            .get(id)
            .map(|doc| doc.view(false))
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })
    }

    pub fn text(&self, id: &str) -> AppResult<String> {
        self.docs
            .get(id)
            .map(|doc| doc.text.clone())
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })
    }

    pub fn path(&self, id: &str) -> AppResult<PathBuf> {
        self.docs
            .get(id)
            .map(|doc| doc.path.clone())
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })
    }

    pub fn save(
        &mut self,
        id: &str,
        text: &str,
        expected_disk_hash: Option<&str>,
        force: bool,
    ) -> AppResult<SaveOutcome> {
        let current_hash = self.current_disk_hash(id)?;
        let doc = self
            .docs
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;

        if let Some(expected) = expected_disk_hash {
            if expected != doc.disk_hash {
                return Err(AppError::Conflict {
                    disk_hash: current_hash.unwrap_or_default(),
                    expected_hash: expected.to_string(),
                });
            }
        }
        if current_hash.as_deref() != Some(doc.disk_hash.as_str()) && !force {
            return Err(AppError::Conflict {
                disk_hash: current_hash.clone().unwrap_or_default(),
                expected_hash: doc.disk_hash.clone(),
            });
        }

        let normalized = normalize_eol(text);
        let mut wrote = false;
        let mut bytes_written = 0u64;
        if normalized != doc.original_text || force {
            let bytes = encode(&normalized, doc.encoding, doc.save_eol);
            atomic_write(&doc.path, &bytes)?;
            bytes_written = bytes.len() as u64;
            doc.disk_hash = sha256_hex(&bytes);
            doc.original_raw = bytes;
            doc.original_text = normalized.clone();
            doc.text = normalized;
            doc.revision += 1;
            doc.converted_from = None;
            doc.size = bytes_written;
            if let Ok(metadata) = fs::metadata(&doc.path) {
                doc.modified_ms = modified_ms(&metadata);
                doc.read_only = metadata.permissions().readonly();
            }
            wrote = true;
        }
        Ok(SaveOutcome {
            document: doc.view(wrote),
            wrote,
            bytes_written,
        })
    }

    pub fn save_as(
        &mut self,
        id: &str,
        new_path: &Path,
        text: &str,
        force: bool,
    ) -> AppResult<SaveOutcome> {
        ensure_supported_document(new_path)?;
        let parent = new_path
            .parent()
            .ok_or_else(|| AppError::invalid("target path has no parent directory"))?;
        let canonical_parent = fs::canonicalize(parent).map_err(|e| {
            AppError::io(
                format!("could not resolve target directory: {e}"),
                Some(parent),
            )
        })?;
        let file_name = new_path
            .file_name()
            .ok_or_else(|| AppError::invalid("target path has no file name"))?;
        let target = canonical_parent.join(file_name);

        let doc = self
            .docs
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;

        if target.exists() && target != doc.path && !force {
            let hash = fs::read(&target)
                .map(|bytes| sha256_hex(&bytes))
                .map_err(|e| AppError::io(e.to_string(), Some(&target)))?;
            return Err(AppError::Conflict {
                disk_hash: hash,
                expected_hash: String::new(),
            });
        }

        let normalized = normalize_eol(text);
        let bytes = encode(&normalized, doc.encoding, doc.save_eol);
        atomic_write(&target, &bytes)?;

        doc.path = target;
        doc.text = normalized.clone();
        doc.original_text = normalized;
        doc.original_raw = bytes.clone();
        doc.disk_hash = sha256_hex(&bytes);
        doc.revision += 1;
        doc.converted_from = None;
        doc.size = bytes.len() as u64;
        if let Ok(metadata) = fs::metadata(&doc.path) {
            doc.read_only = metadata.permissions().readonly();
            doc.modified_ms = modified_ms(&metadata);
        }
        Ok(SaveOutcome {
            document: doc.view(true),
            wrote: true,
            bytes_written: bytes.len() as u64,
        })
    }

    pub fn check_external(&self, id: &str) -> AppResult<ExternalChange> {
        let doc = self
            .docs
            .get(id)
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;
        let metadata = fs::metadata(&doc.path).ok();
        let bytes = fs::read(&doc.path).ok();
        let disk_hash = bytes.as_ref().map(|b| sha256_hex(b));
        Ok(ExternalChange {
            changed: disk_hash.as_deref() != Some(doc.disk_hash.as_str()),
            known_hash: doc.disk_hash.clone(),
            disk_hash,
            disk_size: metadata.map(|m| m.len()),
        })
    }

    pub fn reload(&mut self, id: &str) -> AppResult<DocumentView> {
        let doc = self
            .docs
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;
        let (bytes, metadata) = read_raw(&doc.path)?;
        let decoded = decode(bytes, doc.converted_from.as_deref())?;
        let size = metadata.len();
        let read_only = metadata.permissions().readonly();
        let modified = modified_ms(&metadata);
        let revision = doc.revision + 1;
        let new_doc = OpenDocument::from_decoded(
            doc.id.clone(),
            doc.path.clone(),
            decoded,
            size,
            read_only,
            modified,
        );
        *doc = OpenDocument {
            revision,
            ..new_doc
        };
        Ok(doc.view(false))
    }

    pub fn close(&mut self, id: &str) {
        self.docs.remove(id);
    }

    pub fn open_ids(&self) -> Vec<String> {
        self.docs.keys().cloned().collect()
    }

    fn current_disk_hash(&self, id: &str) -> AppResult<Option<String>> {
        let doc = self
            .docs
            .get(id)
            .ok_or_else(|| AppError::NotFound { id: id.to_string() })?;
        Ok(fs::read(&doc.path).ok().map(|bytes| sha256_hex(&bytes)))
    }
}

impl OpenDocument {
    fn from_decoded(
        id: String,
        path: PathBuf,
        decoded: DecodedDocument,
        size: u64,
        read_only: bool,
        modified: Option<i64>,
    ) -> Self {
        let disk_hash = sha256_hex(&decoded.raw);
        let encoding = decoded.encoding;
        let eol = decoded.eol;
        let save_eol = decoded.save_eol;
        let converted_from = decoded.converted_from;
        Self {
            id,
            path,
            text: decoded.text.clone(),
            original_text: decoded.text,
            original_raw: decoded.raw,
            encoding,
            eol,
            save_eol,
            disk_hash,
            revision: 1,
            converted_from,
            size,
            read_only,
            modified_ms: modified,
        }
    }

    fn view(&self, written: bool) -> DocumentView {
        let mut warnings = Vec::new();
        if self.eol == Eol::Mixed {
            warnings.push(DocumentWarning {
                code: "mixed_eol".into(),
                message: "This file mixes LF and CRLF. Saving after edits normalizes new lines to the dominant style.".into(),
            });
        }
        if let Some(source) = &self.converted_from {
            warnings.push(DocumentWarning {
                code: "converted_encoding".into(),
                message: format!(
                    "Opened after an explicit conversion from {source}. Saving writes UTF-8."
                ),
            });
        }
        DocumentView {
            id: self.id.clone(),
            path: display_path(&self.path),
            title: self
                .path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string()),
            text: self.text.clone(),
            encoding: self.encoding.label().to_string(),
            eol: self.eol.label().to_string(),
            bom: self.encoding.has_bom(),
            disk_hash: self.disk_hash.clone(),
            content_hash: sha256_text(&self.text),
            revision: self.revision,
            size: self.size,
            modified_ms: self.modified_ms,
            read_only: self.read_only,
            written,
            warnings,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_doc(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("文 稿.md");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(bytes).unwrap();
        (dir, path)
    }

    #[test]
    fn no_edit_save_is_byte_identical_for_all_golden_edge_cases() {
        let cases: Vec<Vec<u8>> = vec![
            "中文\r\n第二行\r\n".as_bytes().to_vec(),
            [&[0xEF, 0xBB, 0xBF][..], b"# BOM title\n"].concat(),
            b"---\ntitle: x\n---\n\n| a | b |\n|---|---|\n".to_vec(),
            b"line\r\nmixed\nendings\r".to_vec(),
            "emoji 👩‍👩‍👧‍👦 and combining e\u{0301}\n".as_bytes().to_vec(),
        ];
        for raw in cases {
            let (_dir, path) = temp_doc(&raw);
            let mut store = DocumentStore::default();
            let view = store.open(&path, None, None).unwrap();
            let outcome = store
                .save(&view.id, &view.text, Some(&view.disk_hash), false)
                .unwrap();
            assert!(!outcome.wrote);
            assert_eq!(fs::read(&path).unwrap(), raw);
        }
    }

    #[test]
    fn editing_preserves_eol_and_bom() {
        let raw = [&[0xEF, 0xBB, 0xBF][..], b"# title\r\nbody\r\n"].concat();
        let (_dir, path) = temp_doc(&raw);
        let mut store = DocumentStore::default();
        let view = store.open(&path, None, None).unwrap();
        let outcome = store
            .save(&view.id, "# title\r\nbody changed\r\n", None, false)
            .unwrap();
        assert!(outcome.wrote);
        assert_eq!(
            fs::read(&path).unwrap(),
            [&[0xEF, 0xBB, 0xBF][..], b"# title\r\nbody changed\r\n"].concat()
        );
    }

    #[test]
    fn external_change_is_a_conflict_unless_forced() {
        let (_dir, path) = temp_doc(b"original\n");
        let mut store = DocumentStore::default();
        let view = store.open(&path, None, None).unwrap();
        fs::write(&path, b"external edit\n").unwrap();

        let err = store
            .save(&view.id, "local edit\n", None, false)
            .unwrap_err();
        assert_eq!(err.code(), "external_conflict");
        assert_eq!(fs::read(&path).unwrap(), b"external edit\n");

        let outcome = store.save(&view.id, "local edit\n", None, true).unwrap();
        assert!(outcome.wrote);
        assert_eq!(fs::read(&path).unwrap(), b"local edit\n");
    }

    #[test]
    fn save_failure_keeps_original_file_intact() {
        let (_dir, path) = temp_doc(b"safe\n");
        let mut store = DocumentStore::default();
        let view = store.open(&path, None, None).unwrap();
        // Remove the parent through a rename dance is unsafe; instead force an
        // unsupported target directory by saving as a nested missing folder.
        let err = store
            .save_as(
                &view.id,
                &path.with_file_name("missing").join("x.md"),
                "x",
                false,
            )
            .unwrap_err();
        assert_eq!(err.code(), "io_error");
        assert_eq!(fs::read(&path).unwrap(), b"safe\n");
        assert_eq!(store.text(&view.id).unwrap(), "safe\n");
    }

    #[test]
    fn reload_adopts_disk_content() {
        let (_dir, path) = temp_doc(b"v1\n");
        let mut store = DocumentStore::default();
        let view = store.open(&path, None, None).unwrap();
        fs::write(&path, b"v2\r\n").unwrap();
        let reloaded = store.reload(&view.id).unwrap();
        assert_eq!(reloaded.text, "v2\n");
        assert_eq!(reloaded.eol, "crlf");
        assert_eq!(reloaded.revision, 2);
    }
}
