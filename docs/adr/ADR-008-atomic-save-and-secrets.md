# ADR-008：原子保存与密钥隔离

- 状态：Accepted
- 日期：2026-10-22
- 关联：VES-009、VES-019、VES-020、VES-052

## 决策

1. 保存写入同目录临时文件 → `flush` + `sync_all` → Windows `ReplaceFileW` 替换目标；不支持时回退到「备份—替换—失败恢复」。
2. 任何失败都保留原文件与编辑器脏状态；错误码区分 `external_conflict`、`permission_denied`、`io_error`。
3. API key 只写入 Windows 凭据管理器（service `com.vesrio.app`，account `provider-default`），SQLite 表结构不含 key 列。
4. 日志与审计事件经 `security::redact` 过滤：敏感键名（key/secret/token/content/text/prompt/message 等）整体替换为 `[REDACTED]`，自由文本再按常见密钥形状清洗。
5. 数据库迁移失败时回滚事务，并在迁移前保留备份；快照内容写入独立目录，不操作用户任意路径。

## 后果

- 网络盘或特殊文件系统可能走备份回退路径，极端断电窗口仍需快照兜底。
- 卸载应用不会删除用户 `.md`；应用数据目录需用户手动清理。

## 验证

- 原子保存失败保护：`src-tauri/src/document/atomic.rs`、`store.rs` 测试。
- 脱敏：`src-tauri/src/security/redact.rs` 单测。
- 凭据库无 key 列：迁移 SQL 与 `storage/db.rs` 测试。
