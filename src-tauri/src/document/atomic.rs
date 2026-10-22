//! Atomic file replacement.
//!
//! A save writes a sibling temporary file, flushes it to disk, then replaces
//! the target. On Windows `ReplaceFileW` is used so the ACL and file identity
//! of the target are preserved. Failure leaves the original file untouched.

use crate::error::{AppError, AppResult};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

fn temp_sibling(target: &Path) -> AppResult<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::invalid("target path has no parent directory"))?;
    let name = target
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.md");
    Ok(parent.join(format!(".{name}.{}.vesrio-tmp", uuid::Uuid::new_v4())))
}

#[cfg(windows)]
fn replace_existing(target: &Path, temp: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let target_w = wide(target);
    let temp_w = wide(temp);
    let ok = unsafe {
        ReplaceFileW(
            target_w.as_ptr(),
            temp_w.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_existing(target: &Path, temp: &Path) -> std::io::Result<()> {
    fs::rename(temp, target)
}

/// Fallback used when the filesystem does not support `ReplaceFileW`
/// (for example some network shares). The original is moved aside first and
/// restored if the replacement fails.
fn replace_with_backup(target: &Path, temp: &Path) -> std::io::Result<()> {
    let backup = target.with_extension(format!(
        "{}.vesrio-backup",
        target
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
    ));
    let _ = fs::remove_file(&backup);
    fs::rename(target, &backup)?;
    match fs::rename(temp, target) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, target);
            Err(error)
        }
    }
}

pub fn atomic_write(target: &Path, bytes: &[u8]) -> AppResult<()> {
    if target.is_dir() {
        return Err(AppError::io(
            "target path is a directory, refusing to replace it",
            Some(target),
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| AppError::invalid("target path has no parent directory"))?;
    if !parent.is_dir() {
        return Err(AppError::io(
            "parent directory does not exist",
            Some(parent),
        ));
    }
    let temp = temp_sibling(target)?;

    let write_result = (|| -> std::io::Result<()> {
        let mut file: File = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(AppError::io(
            format!("could not write temporary file: {error}"),
            Some(target),
        ));
    }

    let replaced = if target.exists() {
        replace_existing(target, &temp).or_else(|_| replace_with_backup(target, &temp))
    } else {
        fs::rename(&temp, target)
    };

    if let Err(error) = replaced {
        let _ = fs::remove_file(&temp);
        return Err(AppError::io(
            format!("could not replace document: {error}"),
            Some(target),
        ));
    }

    // Verify what actually landed on disk. A mismatch is a hard error so the
    // caller keeps its dirty state and can retry or save elsewhere.
    let written = fs::read(target)
        .map_err(|e| AppError::io(format!("could not verify saved file: {e}"), Some(target)))?;
    if crate::document::encoding::sha256_hex(&written)
        != crate::document::encoding::sha256_hex(bytes)
    {
        return Err(AppError::io(
            "saved file content did not match the requested content",
            Some(target),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_new_and_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, "第一版\n".as_bytes()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "第一版\n".as_bytes());
        atomic_write(&path, "second\r\n".as_bytes()).unwrap();
        assert_eq!(fs::read(&path).unwrap(), "second\r\n".as_bytes());
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains("vesrio-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files must be cleaned up");
    }

    #[test]
    fn missing_parent_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope").join("note.md");
        let err = atomic_write(&path, b"x").unwrap_err();
        assert_eq!(err.code(), "io_error");
    }

    #[test]
    fn invalid_target_directory_is_rejected_without_side_effects() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::create_dir(&path).unwrap();
        assert!(atomic_write(&path, b"data").is_err());
        assert!(
            path.is_dir(),
            "a failed save must not remove the existing path"
        );
    }
}
