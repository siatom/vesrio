//! Encoding and line-ending handling.
//!
//! Rules (ADR-001):
//! - UTF-8 is the native format. BOM and CRLF are preserved.
//! - Non-UTF-8 files are never transcoded implicitly. The caller receives a
//!   diagnostic and must ask the author before re-opening with `convert_with`.
//! - Saving an unedited document must be byte-identical, therefore `decode`
//!   keeps the original bytes and normalized text side by side.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
}

impl Encoding {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Utf8 => "utf-8",
            Self::Utf8Bom => "utf-8-bom",
        }
    }

    pub fn has_bom(&self) -> bool {
        matches!(self, Self::Utf8Bom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Mixed,
}

impl Eol {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Lf => "lf",
            Self::Crlf => "crlf",
            Self::Mixed => "mixed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DecodedDocument {
    /// Text with normalized `\n` line endings, as used by CodeMirror.
    pub text: String,
    pub raw: Vec<u8>,
    pub encoding: Encoding,
    pub eol: Eol,
    /// Concrete line ending to use on save when `eol == Mixed`.
    pub save_eol: &'static str,
    /// Present when the author explicitly converted a legacy encoding.
    pub converted_from: Option<String>,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn sha256_text(text: &str) -> String {
    sha256_hex(normalize_eol(text).as_bytes())
}

pub fn normalize_eol(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn detect_eol(text: &str) -> Eol {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    if crlf > 0 && (lf > 0 || cr > 0) {
        Eol::Mixed
    } else if crlf > 0 {
        Eol::Crlf
    } else if cr > 0 {
        Eol::Mixed
    } else {
        Eol::Lf
    }
}

fn dominant_eol(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    if crlf > 0 && crlf >= lf {
        "\r\n"
    } else {
        "\n"
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn ensure_supported_document(path: &Path) -> AppResult<()> {
    const ALLOWED: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];
    let ext = extension_of(path);
    if ALLOWED.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(AppError::UnsupportedDocumentType { extension: ext })
    }
}

/// Decode raw bytes using UTF-8 unless the author explicitly requests a legacy
/// encoding via `convert_with`.
pub fn decode(bytes: Vec<u8>, convert_with: Option<&str>) -> AppResult<DecodedDocument> {
    if let Some(label) = convert_with {
        return decode_with_label(bytes, label);
    }

    let had_bom = bytes.starts_with(UTF8_BOM);
    let body = if had_bom { &bytes[3..] } else { &bytes[..] };

    match std::str::from_utf8(body) {
        Ok(text) => {
            let eol = detect_eol(text);
            let save_eol = dominant_eol(text);
            let normalized = normalize_eol(text);
            Ok(DecodedDocument {
                text: normalized,
                raw: bytes,
                encoding: if had_bom {
                    Encoding::Utf8Bom
                } else {
                    Encoding::Utf8
                },
                eol,
                save_eol,
                converted_from: None,
            })
        }
        Err(_) => {
            let detected = detect_legacy_encoding(body);
            Err(AppError::UnsupportedEncoding { encoding: detected })
        }
    }
}

fn detect_legacy_encoding(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return "utf-16le".to_string();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return "utf-16be".to_string();
    }
    // A UTF-16 file without BOM is rare; the NUL pattern is still a useful hint.
    if bytes.len() >= 4 {
        let zeros_even = bytes.iter().step_by(2).filter(|b| **b == 0).count();
        let zeros_odd = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
        let half = bytes.len() / 2;
        if zeros_odd > half / 2 {
            return "utf-16le".to_string();
        }
        if zeros_even > half / 2 {
            return "utf-16be".to_string();
        }
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    detector.guess(None, true).name().to_ascii_lowercase()
}

fn decode_with_label(bytes: Vec<u8>, label: &str) -> AppResult<DecodedDocument> {
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes())
        .ok_or_else(|| AppError::invalid(format!("unknown encoding: {label}")))?;
    let (decoded, _, had_errors) = encoding.decode(&bytes);
    if had_errors {
        return Err(AppError::UnsupportedEncoding {
            encoding: label.to_string(),
        });
    }
    let text = decoded.into_owned();
    let eol = detect_eol(&text);
    Ok(DecodedDocument {
        text: normalize_eol(&text),
        raw: bytes,
        encoding: Encoding::Utf8,
        eol,
        save_eol: dominant_eol(&text),
        converted_from: Some(label.to_string()),
    })
}

/// Encode normalized text back to bytes while preserving BOM and EOL style.
pub fn encode(text: &str, encoding: Encoding, save_eol: &str) -> Vec<u8> {
    let body = if save_eol == "\r\n" {
        text.replace('\n', "\r\n")
    } else {
        text.to_string()
    };
    let mut out = Vec::with_capacity(body.len() + 3);
    if encoding.has_bom() {
        out.extend_from_slice(UTF8_BOM);
    }
    out.extend_from_slice(body.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_crlf_and_normalizes() {
        let doc = decode("第一行\r\nsecond\r\n".as_bytes().to_vec(), None).unwrap();
        assert_eq!(doc.eol, Eol::Crlf);
        assert_eq!(doc.save_eol, "\r\n");
        assert_eq!(doc.text, "第一行\nsecond\n");
        assert_eq!(
            encode(&doc.text, doc.encoding, doc.save_eol),
            "第一行\r\nsecond\r\n".as_bytes()
        );
    }

    #[test]
    fn detects_mixed_eol_without_losing_bytes_on_noop() {
        let raw = b"a\r\nb\nc\rd".to_vec();
        let doc = decode(raw.clone(), None).unwrap();
        assert_eq!(doc.eol, Eol::Mixed);
        assert_eq!(doc.text, "a\nb\nc\nd");
        let reencoded = encode(&doc.text, doc.encoding, doc.save_eol);
        assert_ne!(reencoded, raw);
        // The store skips writing when text is unchanged, which is what keeps
        // mixed-EOL golden samples byte-identical.
    }

    #[test]
    fn detects_bom_and_round_trips() {
        let raw = [UTF8_BOM, b"# title\n".as_slice()].concat();
        let doc = decode(raw.clone(), None).unwrap();
        assert_eq!(doc.encoding, Encoding::Utf8Bom);
        assert_eq!(encode(&doc.text, doc.encoding, doc.save_eol), raw);
    }

    #[test]
    fn rejects_latin1_without_silent_transcoding() {
        let raw = vec![0xE9, 0x74, 0xE9];
        let err = decode(raw, None).unwrap_err();
        match err {
            AppError::UnsupportedEncoding { encoding } => assert!(!encoding.is_empty()),
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn explicit_legacy_conversion_works() {
        let raw = b"\xC4\xE3\xBA\xC3".to_vec(); // 你好 in GBK
        let doc = decode(raw, Some("gbk")).unwrap();
        assert_eq!(doc.text, "你好");
        assert_eq!(doc.converted_from.as_deref(), Some("gbk"));
    }

    #[test]
    fn sha256_is_stable_across_line_endings() {
        assert_eq!(sha256_text("a\r\nb"), sha256_text("a\nb"));
    }

    #[test]
    fn rejects_non_markdown_extensions() {
        assert!(ensure_supported_document(Path::new("a.exe")).is_err());
        assert!(ensure_supported_document(Path::new("a.MD")).is_ok());
    }
}
