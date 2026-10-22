use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub children: Vec<FileNode>,
}

const IGNORED_DIRS: [&str; 12] = [
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
    ".obsidian",
    ".trash",
    "__pycache__",
    ".venv",
];
const MAX_DEPTH: usize = 10;
const MAX_NODES: usize = 4000;

pub fn scan_directory(root: &Path) -> AppResult<FileNode> {
    let canonical = fs::canonicalize(root)
        .map_err(|e| AppError::io(format!("could not resolve folder: {e}"), Some(root)))?;
    if !canonical.is_dir() {
        return Err(AppError::invalid("selected path is not a folder"));
    }
    let mut budget = MAX_NODES;
    let children = scan_children(&canonical, 0, &mut budget)?;
    Ok(FileNode {
        name: canonical
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| crate::document::display_path(&canonical)),
        path: crate::document::display_path(&canonical),
        is_dir: true,
        size: None,
        children,
    })
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".md", ".markdown", ".mdown", ".mkd", ".txt"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn scan_children(dir: &Path, depth: usize, budget: &mut usize) -> AppResult<Vec<FileNode>> {
    if depth >= MAX_DEPTH || *budget == 0 {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(dir)
        .map_err(|e| AppError::io(format!("could not read folder: {e}"), Some(dir)))?;
    let mut nodes = Vec::new();
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            *budget -= 1;
            let children = scan_children(&path, depth + 1, budget)?;
            nodes.push(FileNode {
                name,
                path: crate::document::display_path(&path),
                is_dir: true,
                size: None,
                children,
            });
        } else if metadata.is_file() && is_markdown(&name) {
            *budget -= 1;
            nodes.push(FileNode {
                name,
                path: crate::document::display_path(&path),
                is_dir: false,
                size: Some(metadata.len()),
                children: Vec::new(),
            });
        }
    }
    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(nodes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scans_markdown_and_skips_noise() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "# a\n").unwrap();
        fs::write(dir.path().join("ignore.png"), "x").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("b.markdown"), "# b\n").unwrap();
        fs::create_dir(dir.path().join("node_modules")).unwrap();
        fs::write(dir.path().join("node_modules").join("x.md"), "x").unwrap();

        let tree = scan_directory(dir.path()).unwrap();
        let names: Vec<_> = tree.children.iter().map(|n| n.name.clone()).collect();
        assert!(names.contains(&"a.md".to_string()));
        assert!(names.contains(&"sub".to_string()));
        assert!(!names.contains(&"ignore.png".to_string()));
        assert!(!names.contains(&"node_modules".to_string()));
        let sub = tree.children.iter().find(|n| n.name == "sub").unwrap();
        assert_eq!(sub.children[0].name, "b.markdown");
    }

    #[test]
    fn empty_document_is_valid() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.md");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(b"").unwrap();
        let tree = scan_directory(dir.path()).unwrap();
        assert_eq!(tree.children[0].size, Some(0));
    }
}
