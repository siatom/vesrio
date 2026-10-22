//! Performance and persistence checks that do not require a window.

use std::fs;
use std::time::{Duration, Instant};
use vesrio_lib::document::{DocumentStore, SnapshotStore};
use vesrio_lib::storage::Db;

#[test]
fn ten_megabyte_document_opens_and_saves_without_rewriting() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.md");
    let paragraph =
        "# 大文档\n\n这是一段用于性能验证的中文正文，包含标点、数字 2026 与 English words。\n\n";
    let mut content = String::with_capacity(10 * 1024 * 1024 + paragraph.len());
    while content.len() < 10 * 1024 * 1024 {
        content.push_str(paragraph);
    }
    fs::write(&path, content.as_bytes()).unwrap();
    let size = fs::metadata(&path).unwrap().len();
    assert!(size >= 10 * 1024 * 1024);

    let mut store = DocumentStore::default();
    let started = Instant::now();
    let view = store.open(&path, None, None).unwrap();
    let open_time = started.elapsed();
    assert_eq!(view.text.len(), content.len());

    let started = Instant::now();
    let outcome = store
        .save(&view.id, &view.text, Some(&view.disk_hash), false)
        .unwrap();
    let save_time = started.elapsed();
    assert!(!outcome.wrote);

    eprintln!(
        "10 MB document: open={:?}, no-edit save={:?}",
        open_time, save_time
    );
    assert!(
        open_time < Duration::from_secs(10),
        "opening 10 MB took {open_time:?}"
    );
    assert!(
        save_time < Duration::from_secs(2),
        "no-edit save of 10 MB took {save_time:?}"
    );
}

#[test]
fn snapshot_survives_a_database_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("vesrio.db");
    let snapshot_root = dir.path().join("snapshots");
    let content = "# 恢复点\n\n这份内容应在重启后仍可读取。\n";
    let snapshot_id = {
        let db = Db::open(&db_path).unwrap();
        let store = SnapshotStore::new(snapshot_root.clone());
        store.create(&db, "doc-1", content, "manual").unwrap().id
    };

    let db = Db::open(&db_path).unwrap();
    let store = SnapshotStore::new(snapshot_root);
    let file = store.read(&db, &snapshot_id).unwrap();
    assert_eq!(file.content, content);
    assert_eq!(file.record.document_id, "doc-1");
}

#[test]
fn corrupt_snapshot_is_rejected_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("vesrio.db");
    let snapshot_root = dir.path().join("snapshots");
    let record = {
        let db = Db::open(&db_path).unwrap();
        let store = SnapshotStore::new(snapshot_root.clone());
        store.create(&db, "doc-1", "原始内容", "manual").unwrap()
    };

    let db = Db::open(&db_path).unwrap();
    let (_, path) = db.get_snapshot(&record.id).unwrap();
    fs::write(path, "被篡改").unwrap();
    let store = SnapshotStore::new(snapshot_root);
    assert!(store.read(&db, &record.id).is_err());
}
