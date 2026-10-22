//! UTF-16 ↔ UTF-8 boundary conversion, anchor capture and the pure apply
//! computation. CodeMirror positions are UTF-16 code units; Rust strings are
//! UTF-8 bytes. Every crossing goes through this module.

use crate::document::encoding::sha256_text;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

pub const CONTEXT_CHARS: usize = 120;
const MAX_CANDIDATE_CHARS: usize = 8000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectionAnchor {
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub selected_text_sha256: String,
    pub context_before: String,
    pub context_after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyComputation {
    pub new_text: String,
    pub from_utf16: usize,
    pub to_utf16: usize,
    pub replaced_text: String,
    pub inserted_text: String,
    pub applied_text_hash: String,
}

pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Convert a UTF-16 code-unit index into a UTF-8 byte index. An index inside a
/// surrogate pair is rejected instead of silently rounding.
pub fn utf16_to_byte(text: &str, utf16_index: usize) -> AppResult<usize> {
    let mut position = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if position == utf16_index {
            return Ok(byte_index);
        }
        if position > utf16_index {
            return Err(AppError::invalid(
                "UTF-16 offset points inside a surrogate pair",
            ));
        }
        position += ch.len_utf16();
    }
    if position == utf16_index {
        Ok(text.len())
    } else {
        Err(AppError::invalid("UTF-16 offset is out of range"))
    }
}

pub fn byte_to_utf16(text: &str, byte_index: usize) -> AppResult<usize> {
    if byte_index > text.len() || !text.is_char_boundary(byte_index) {
        return Err(AppError::invalid("byte offset is not a character boundary"));
    }
    Ok(utf16_len(&text[..byte_index]))
}

pub fn slice_utf16(text: &str, from: usize, to: usize) -> AppResult<&str> {
    if from > to {
        return Err(AppError::invalid("selection start is after its end"));
    }
    let start = utf16_to_byte(text, from)?;
    let end = utf16_to_byte(text, to)?;
    Ok(&text[start..end])
}

pub fn capture_anchor(text: &str, from: usize, to: usize) -> AppResult<SelectionAnchor> {
    let selected = slice_utf16(text, from, to)?;
    let start = utf16_to_byte(text, from)?;
    let end = utf16_to_byte(text, to)?;
    let before: String = {
        let prefix = &text[..start];
        prefix
            .chars()
            .rev()
            .take(CONTEXT_CHARS)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    };
    let after: String = text[end..].chars().take(CONTEXT_CHARS).collect();
    Ok(SelectionAnchor {
        from_utf16: from,
        to_utf16: to,
        selected_text_sha256: sha256_text(selected),
        context_before: before,
        context_after: after,
    })
}

/// The pure apply step. It never writes files: the caller turns the returned
/// text into one editor transaction, then saves through the normal path.
pub fn compute_apply(
    text: &str,
    from: usize,
    to: usize,
    expected_selected_hash: &str,
    candidate: &str,
) -> AppResult<ApplyComputation> {
    let replaced = slice_utf16(text, from, to)?.to_string();
    let current_hash = sha256_text(&replaced);
    if current_hash != expected_selected_hash {
        return Err(AppError::Stale {
            reason: "the selected text changed after the suggestion was generated".into(),
        });
    }
    if candidate.chars().count() > MAX_CANDIDATE_CHARS {
        return Err(AppError::invalid(
            "candidate is longer than the safe application limit",
        ));
    }
    if candidate.contains('\0') {
        return Err(AppError::invalid("candidate contains a NUL character"));
    }
    let start = utf16_to_byte(text, from)?;
    let end = utf16_to_byte(text, to)?;
    let mut new_text = String::with_capacity(text.len() + candidate.len());
    new_text.push_str(&text[..start]);
    new_text.push_str(candidate);
    new_text.push_str(&text[end..]);
    let inserted_len = utf16_len(candidate);
    Ok(ApplyComputation {
        new_text,
        from_utf16: from,
        to_utf16: from + inserted_len,
        replaced_text: replaced,
        inserted_text: candidate.to_string(),
        applied_text_hash: sha256_text(candidate),
    })
}

/// Find the paragraph around a selection, used when the author explicitly
/// grants paragraph-context reading. Returns a UTF-16 range.
pub fn paragraph_range(text: &str, from: usize, to: usize) -> AppResult<(usize, usize)> {
    let start_byte = utf16_to_byte(text, from)?;
    let end_byte = utf16_to_byte(text, to)?;
    let before = &text[..start_byte];
    let after = &text[end_byte..];
    let paragraph_start = before
        .rfind("\n\n")
        .map(|idx| idx + 2)
        .unwrap_or(0)
        .max(start_byte.saturating_sub(4000));
    let paragraph_end = after
        .find("\n\n")
        .map(|idx| end_byte + idx)
        .unwrap_or(text.len())
        .min(end_byte + 4000);
    let from_utf16 = byte_to_utf16(text, paragraph_start)?;
    let to_utf16 = byte_to_utf16(text, paragraph_end)?;
    Ok((from_utf16, to_utf16))
}

/// Locate an exact citation snippet in the document. Returns UTF-16 offsets.
pub fn find_exact(text: &str, snippet: &str) -> Option<(usize, usize)> {
    if snippet.is_empty() {
        return None;
    }
    let byte_start = text.find(snippet)?;
    let byte_end = byte_start + snippet.len();
    let from = byte_to_utf16(text, byte_start).ok()?;
    let to = byte_to_utf16(text, byte_end).ok()?;
    Some((from, to))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_offsets_for_chinese_and_emoji() {
        let text = "甲乙👩‍👩‍👧‍👦丙";
        // 甲(1) 乙(1) family emoji(11 code units) 丙(1)
        assert_eq!(utf16_len(text), 14);
        assert_eq!(utf16_to_byte(text, 0).unwrap(), 0);
        assert_eq!(utf16_to_byte(text, 1).unwrap(), 3);
        assert_eq!(utf16_to_byte(text, 2).unwrap(), 6);
        assert_eq!(utf16_to_byte(text, 13).unwrap(), text.len() - 3);
        assert_eq!(utf16_to_byte(text, 14).unwrap(), text.len());
        assert_eq!(slice_utf16(text, 2, 13).unwrap(), "👩‍👩‍👧‍👦");
    }

    #[test]
    fn rejects_offsets_inside_surrogate_pairs() {
        let text = "a😀b";
        let err = utf16_to_byte(text, 2).unwrap_err();
        assert_eq!(err.code(), "invalid_input");
        assert!(utf16_to_byte(text, 99).is_err());
    }

    #[test]
    fn anchor_hash_matches_crlf_normalized_text() {
        // The store normalizes CRLF before anchors are captured.
        let anchor = capture_anchor("前文\n选中\n后文", 3, 5).unwrap();
        assert_eq!(anchor.selected_text_sha256, sha256_text("选中"));
    }

    #[test]
    fn apply_changes_only_the_selected_range() {
        let text = "开头。原文句子。结尾。";
        let from = utf16_len("开头。");
        let to = from + utf16_len("原文句子。");
        let anchor = capture_anchor(text, from, to).unwrap();
        let result =
            compute_apply(text, from, to, &anchor.selected_text_sha256, "新句子。").unwrap();
        assert_eq!(result.new_text, "开头。新句子。结尾。");
        assert_eq!(result.from_utf16, from);
        assert_eq!(result.to_utf16, from + 4);
        assert_eq!(result.replaced_text, "原文句子。");
    }

    #[test]
    fn stale_hash_is_rejected() {
        let text = "原文";
        let err = compute_apply(text, 0, 2, &sha256_text("别的"), "候选").unwrap_err();
        assert_eq!(err.code(), "stale_suggestion");
    }

    #[test]
    fn oversized_candidate_is_rejected() {
        let text = "原文";
        let hash = sha256_text(text);
        let err = compute_apply(text, 0, 2, &hash, &"长".repeat(9000)).unwrap_err();
        assert_eq!(err.code(), "invalid_input");
    }

    #[test]
    fn paragraph_range_stops_at_blank_lines() {
        let text = "第一段。\n\n第二段第一句。第二段第二句。\n\n第三段。";
        let from = utf16_len("第一段。\n\n");
        let to = from + utf16_len("第二段第一句。");
        let (start, end) = paragraph_range(text, from, to).unwrap();
        assert_eq!(
            slice_utf16(text, start, end).unwrap(),
            "第二段第一句。第二段第二句。"
        );
    }

    #[test]
    fn citation_lookup_is_exact() {
        let text = "前文\n目标段落\n后文";
        let (from, to) = find_exact(text, "目标段落").unwrap();
        assert_eq!(slice_utf16(text, from, to).unwrap(), "目标段落");
        assert!(find_exact(text, "不存在").is_none());
    }
}
