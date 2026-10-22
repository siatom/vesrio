//! Golden Markdown round-trip tests.
//!
//! The corpus lives in `tests/fixtures/markdown` and is fingerprinted by
//! `scripts/check-golden.mjs`. These tests prove the stronger property: opening
//! and saving without edits never writes a byte, and appending text changes
//! only the bytes after the original content.

use std::fs;
use std::path::{Path, PathBuf};
use vesrio_lib::document::DocumentStore;

fn fixtures() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/markdown");
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("md"))
        .collect();
    files.sort();
    assert!(
        files.len() >= 20,
        "the golden corpus must contain at least 20 samples, found {}",
        files.len()
    );
    files
}

#[test]
fn no_edit_roundtrip_is_byte_identical_for_every_golden_sample() {
    for path in fixtures() {
        let raw = fs::read(&path).unwrap();
        let mut store = DocumentStore::default();
        let view = store
            .open(&path, None, None)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let outcome = store
            .save(&view.id, &view.text, Some(&view.disk_hash), false)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        assert!(
            !outcome.wrote,
            "{} was rewritten without edits",
            path.display()
        );
        assert_eq!(
            fs::read(&path).unwrap(),
            raw,
            "{} changed on a no-edit save",
            path.display()
        );
    }
}

#[test]
fn appending_text_preserves_all_original_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let marker = "追加内容，不改动原有字节。";
    for source in fixtures() {
        let name = source.file_name().unwrap().to_string_lossy().to_string();
        if name.contains("mixed-eol") {
            // Mixed EOL files are documented to normalize on the first real
            // edit; byte-prefix preservation is not promised for that case.
            continue;
        }
        let raw = fs::read(&source).unwrap();
        let target = dir.path().join(&name);
        fs::write(&target, &raw).unwrap();

        let mut store = DocumentStore::default();
        let view = store.open(&target, None, None).unwrap();
        let edited = format!("{}{}", view.text, marker);
        let outcome = store
            .save(&view.id, &edited, Some(&view.disk_hash), false)
            .unwrap();
        assert!(outcome.wrote);

        let written = fs::read(&target).unwrap();
        assert!(
            written.starts_with(&raw),
            "{name}: bytes before the append changed"
        );
        assert_eq!(
            written.len(),
            raw.len() + marker.len(),
            "{name}: unexpected growth"
        );
    }
}

#[test]
fn utf16_and_utf8_boundaries_roundtrip_through_a_real_file() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("emoji.md");
    let original = "# 标题\n\n甲乙👩‍👩‍👧‍👦丙\n";
    fs::write(&target, original.as_bytes()).unwrap();

    let mut store = DocumentStore::default();
    let view = store.open(&target, None, None).unwrap();
    let edited = view.text.replace("丙", "丁");
    let outcome = store
        .save(&view.id, &edited, Some(&view.disk_hash), false)
        .unwrap();
    assert!(outcome.wrote);
    assert_eq!(fs::read_to_string(&target).unwrap(), "# 标题\n\n甲乙👩‍👩‍👧‍👦丁\n");
}
