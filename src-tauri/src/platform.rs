//! Cross-platform capability and display helpers.
//!
//! Keep OS-specific branching in this module, or in a narrowly scoped
//! `#[cfg]` block next to the implementation that needs it. Business logic
//! (document encoding, suggestions, storage) must stay platform-neutral.

use std::path::Path;

pub const OS: &str = std::env::consts::OS;
pub const ARCH: &str = std::env::consts::ARCH;

/// Stable identifier exposed to the frontend, for example `windows-x86_64`.
pub fn label() -> String {
    format!("{OS}-{ARCH}")
}

pub fn is_windows() -> bool {
    cfg!(windows)
}

pub fn is_macos() -> bool {
    cfg!(target_os = "macos")
}

pub fn is_linux() -> bool {
    cfg!(target_os = "linux")
}

/// Path string safe to show in the UI.
///
/// Windows canonicalization returns extended-length paths (`\\?\C:\...`).
/// The prefix is an implementation detail, not something users should see.
/// Other platforms keep the native path unchanged.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_matches_the_rust_target() {
        assert_eq!(
            label(),
            format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
        );
    }

    #[test]
    fn display_path_keeps_regular_paths() {
        let path = Path::new("notes").join("第一章.md");
        assert_eq!(display_path(&path), path.to_string_lossy());
    }

    #[cfg(windows)]
    #[test]
    fn display_path_strips_the_extended_length_prefix_on_windows() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\notes\第一章.md")),
            r"C:\notes\第一章.md"
        );
    }

    #[test]
    fn platform_predicates_match_the_target() {
        assert_eq!(is_windows(), cfg!(windows));
        assert_eq!(is_macos(), cfg!(target_os = "macos"));
        assert_eq!(is_linux(), cfg!(target_os = "linux"));
    }
}
