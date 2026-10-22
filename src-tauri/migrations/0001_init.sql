PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    root_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    style_profile_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    canonical_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    last_opened_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_recent ON documents(last_opened_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Provider configuration intentionally has no API key column. The key lives in
-- the OS credential store (Windows Credential Manager).
CREATE TABLE IF NOT EXISTS provider_configs (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    timeout_ms INTEGER NOT NULL DEFAULT 60000,
    temperature REAL NOT NULL DEFAULT 0.4,
    max_tokens INTEGER NOT NULL DEFAULT 2048,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    project_id TEXT,
    kind TEXT NOT NULL,
    intent TEXT NOT NULL,
    read_scope TEXT NOT NULL,
    write_scope TEXT NOT NULL,
    base_revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_document ON requests(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    from_utf16 INTEGER NOT NULL,
    to_utf16 INTEGER NOT NULL,
    selected_text_hash TEXT NOT NULL,
    original_text TEXT NOT NULL,
    candidate_text TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    selected_candidate INTEGER NOT NULL DEFAULT 0,
    applied_from_utf16 INTEGER,
    applied_to_utf16 INTEGER,
    applied_text_hash TEXT,
    snapshot_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_document ON suggestions(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS suggestion_candidates (
    suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    candidate_text TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (suggestion_id, idx)
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_document ON conversations(document_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS style_profiles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    rules_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_style_project ON style_profiles(project_id, version DESC);

CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    snapshot_path TEXT NOT NULL,
    source TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_document ON snapshots(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
