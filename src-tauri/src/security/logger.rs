//! Application log writer. Logs are structured, redacted and never include
//! document bodies or provider keys.

use super::redact::{redact_json, redact_text};
use crate::error::{AppError, AppResult};
use chrono::Utc;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Logger {
    path: PathBuf,
    file: Mutex<std::fs::File>,
}

impl Logger {
    pub fn new(dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(dir)
            .map_err(|e| AppError::io(format!("could not create log directory: {e}"), Some(dir)))?;
        let path = dir.join("vesrio.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| AppError::io(format!("could not open log file: {e}"), Some(&path)))?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn log(&self, level: &str, event: &str, fields: serde_json::Value) {
        let redacted = redact_json(&fields);
        let line = format!(
            "{} {} event={} fields={}\n",
            Utc::now().to_rfc3339(),
            level,
            event,
            redacted
        );
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(redact_text(&line).as_bytes());
            let _ = file.flush();
        }
    }
}
