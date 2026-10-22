# 技术参考：命令、数据模型与迁移

> 面向维护者。用户操作说明见 [user-guide.md](./user-guide.md)。

## 1. 分层与边界

```text
Vue 3 / Pinia / CodeMirror 6
        │  invoke(command, args) / event(ai:delta, ai:suggestion, ...)
        ▼
Tauri commands（src-tauri/src/commands.rs）
        ├── document：打开、保存、编码、冲突、快照存储
        ├── storage：SQLite 迁移与实体
        ├── provider：OpenAI-compatible 客户端、密钥、SSE
        ├── suggestion：锚点、Prompt、候选校验、Apply
        ├── agent：只读对话与引用
        └── security：日志/审计脱敏
```

硬约束：

- 前端不直接读写文件，不持有 API key，不执行模型返回的指令。
- 正文修改只能由编辑器事务完成；Rust 返回 `newText` 供前端比对，不直接写文件。
- 所有 command 使用统一错误结构（见第 4 节）。
- 所有模型输出按不可信文本处理。

## 2. 运行目录

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\com.vesrio.app\vesrio.db` | 元数据、设置、建议、会话、快照索引、审计 |
| `%APPDATA%\com.vesrio.app\snapshots\` | 快照正文文件 |
| `%APPDATA%\com.vesrio.app\logs\` | 脱敏日志 |
| `%APPDATA%\com.vesrio.app\vesrio.db.bak-v<version>-<stamp>` | 迁移前备份（保留最近 3 份） |

`get_app_info` 返回 `dataDir`、`logPath`、`version`、`platform`；`debug_paths` 额外返回 `database` 与 `snapshotRoot`。

## 3. Tauri 命令

参数与返回值均为 camelCase JSON。命令名使用 snake_case。

### 3.1 应用与文件

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `get_app_info` | — | `AppInfo` |
| `open_document` | `path`, `projectId?`, `convertEncoding?` | `DocumentView` |
| `create_document` | `path` | `DocumentView` |
| `convert_document_encoding` | `path`, `encoding` | `DocumentView` |
| `save_document` | `id`, `text`, `expectedDiskHash?`, `force` | `SaveOutcome` |
| `save_document_as` | `id`, `path`, `text`, `force` | `SaveOutcome` |
| `check_external_change` | `id` | `ExternalChange` |
| `reload_document` | `id` | `DocumentView` |
| `close_document` | `id` | `void` |
| `scan_folder` | `path` | `FileNode` |
| `open_project` | `path` | `ProjectWorkspace` |
| `list_projects` | — | `Project[]` |
| `list_recent_documents` | — | `RecentEntry[]` |
| `get_settings` | — | 设置对象 |
| `set_settings` | `values` | 设置对象 |

`DocumentView` 关键字段：`id`、`path`、`title`、`text`、`encoding`、`eol`、`bom`、`diskHash`、`contentHash`、`revision`、`size`、`readOnly`、`written`、`warnings`。

保存语义：

- `dirty = false` 时不写盘，返回 `wrote = false` 与当前文档视图。
- `expectedDiskHash` 与磁盘不一致且 `force = false` 时返回 `external_conflict`，附带 `diskHash` 与处理选项。
- 写入失败返回 `io_error` / `permission_denied`，原文件不被破坏。

### 3.2 模型配置

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `get_provider_config` | — | `ProviderConfigView`（含 `hasApiKey`，不含 key） |
| `save_provider_config` | `config`, `apiKey?`, `removeApiKey` | `ProviderConfigView` |
| `test_provider` | — | `{ host, models }` |

`ProviderConfig`：`baseUrl`、`model`、`timeoutMs`、`temperature`、`maxTokens`。默认预设为 DeepSeek（`https://api.deepseek.com` / `deepseek-flash`，最大输出 384K）。API key 写入 Windows 凭据管理器，service `com.vesrio.app`，account `provider-default`。

### 3.3 行内建议

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `prepare_suggestion` | `input` | `PreparedRequest` |
| `execute_suggestion` | `requestId` | `SuggestionView` |
| `cancel_request` | `requestId` | `void` |
| `reject_suggestion` | `suggestionId` | `SuggestionView` |
| `mark_suggestion_stale` | `suggestionId` | `SuggestionView` |
| `apply_suggestion` | `suggestionId`, `documentId`, `candidateIndex`, `documentText`, `editRevision` | `ApplyOutcome` |
| `list_suggestions` | `documentId` | `SuggestionView[]` |

`PrepareSuggestionInput`：

```json
{
  "documentId": "...",
  "projectId": "...",
  "documentTitle": "...",
  "documentText": "...",
  "instruction": "精简表达，保留原意与技术事实。",
  "intent": "shorten",
  "candidateCount": 1,
  "readScope": "selection",
  "fromUtf16": 218,
  "toUtf16": 284,
  "selectedTextSha256": null,
  "editRevision": 1
}
```

`PreparedRequest` 返回 `messages`、`outboundChars`、`readScope`、`writeScope`（恒为 `selection_only`）、`model`、`providerHost`、`baseRevision`。

`ApplyOutcome`：`suggestion`、`newText`、`fromUtf16`、`toUtf16`、`snapshotId`、`alreadyApplied`。

应用规则：

1. `suggestion.status` 必须为 `ready`。
2. `editRevision` 必须等于 `baseRevision`。
3. `documentText[fromUtf16..toUtf16]` 的 SHA-256 必须等于 `selectedTextHash`。
4. 否则标记 `stale` 并返回 `stale_suggestion`。
5. 已 `accepted` 的建议返回 `alreadyApplied = true`，不重复写入。
6. 成功前创建 `ai_apply` 快照。

### 3.4 Agent 与风格

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `prepare_chat` | `input` | `PreparedChat` |
| `execute_chat` | `requestId`, `documentText` | `ChatResult` |
| `list_messages` | `conversationId` | `MessageRecord[]` |
| `list_conversations` | `documentId` | `ConversationRecord[]` |
| `get_conversation` | `documentId`, `projectId?` | `ConversationRecord` |
| `get_style_profile` | `projectId` | `StyleProfile` |
| `save_style_profile` | `projectId`, `rules` | `StyleProfile` |

`PrepareChatInput`：`documentId`、`projectId?`、`documentTitle`、`documentText`、`question`、`readScope`、`fromUtf16?`、`toUtf16?`。Agent 的 `writeScope` 为 `none`。

风格规则：`audience`、`tone`、`terminology[]`、`banned[]`、`notes`。规模上限：audience/tone 500 字符，notes 4000 字符，banned 100 项，terminology 200 项。

### 3.5 快照与诊断

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `create_snapshot` | `documentId`, `content`, `source` | `SnapshotRecord` |
| `list_snapshots` | `documentId` | `SnapshotRecord[]` |
| `read_snapshot` | `snapshotId` | `SnapshotFile` |
| `restore_snapshot` | `snapshotId`, `currentText` | `RestoreOutcome` |
| `report_client_event` | `level`, `event`, `fields` | `void` |
| `debug_paths` | — | 路径对象 |

`source` 允许值：`manual`、`before_restore`、`conflict`、`ai_apply`。恢复到编辑器后仍需用户保存；恢复前会自动创建 `before_restore` 快照。

## 4. 错误合同

```json
{
  "code": "external_conflict",
  "message": "The file changed on disk since it was opened",
  "retryable": false,
  "details": { "diskHash": "...", "expectedHash": "...", "options": ["reload", "keep_current", "save_as"] }
}
```

稳定错误码：

| code | 含义 |
| --- | --- |
| `io_error` | 文件读写失败（retryable） |
| `unsupported_encoding` | 非 UTF-8，需要用户确认转换 |
| `unsupported_document_type` | 扩展名不支持 |
| `not_found` | 文档/请求/建议不存在 |
| `external_conflict` | 磁盘文件已被外部修改 |
| `permission_denied` | 权限不足或只读 |
| `storage_error` | SQLite/凭据存储失败 |
| `invalid_input` | 参数、偏移或状态非法 |
| `provider_error` | 模型服务错误，可能 retryable |
| `cancelled` | 用户取消或请求中止 |
| `stale_suggestion` | 建议已过期，禁止应用 |
| `invalid_transition` | 非法状态转移 |
| `not_configured` | 缺少模型服务配置 |
| `internal_error` | 未分类内部错误 |

前端在 `src/lib/errors.ts` 映射为用户文案；日志与错误消息不得包含正文或 key。

## 5. 偏移与文本合同

- TS/CodeMirror 使用 UTF-16 code unit 偏移；Rust 使用 UTF-8 字节索引。
- JSON 字段统一以 `fromUtf16` / `toUtf16` 命名。
- 转换集中在 `src-tauri/src/suggestion/anchor.rs`，拒绝越界、非字符边界、代理对中间位置。
- 选区 hash 使用 UTF-8 字节计算的 SHA-256。
- 测试覆盖中文、emoji、ZWJ 家庭 emoji、组合字符、CRLF、空选区、段落边界。

## 6. SQLite 与迁移

### 6.1 表

| 表 | 用途 |
| --- | --- |
| `projects` | 本地文件夹项目与风格关联 |
| `documents` | 文档路径、标题、最近打开 |
| `app_settings` | 键值设置 |
| `provider_configs` | Base URL、模型、超时、温度、max tokens（无 key） |
| `requests` | 建议/对话请求与状态、payload |
| `suggestions` | 建议正文、锚点、hash、状态、应用结果 |
| `suggestion_candidates` | 2～3 个候选 |
| `conversations` / `messages` | Agent 会话与消息、引用 JSON |
| `style_profiles` | 项目风格版本 |
| `snapshots` | 快照索引（正文在文件系统） |
| `audit_events` | 脱敏审计事件 |

### 6.2 迁移流程

1. 读取 `PRAGMA user_version`。
2. 若低于目标版本且数据库已存在，复制为 `vesrio.db.bak-v<current>-<timestamp>`，只保留最近 3 份。
3. 在单个事务中按版本执行 `migrations/000N_*.sql`。
4. 更新 `user_version`；任一步失败则事务回滚，旧版本保持可用。

新增迁移：

1. 在 `src-tauri/migrations/` 添加新 SQL，禁止修改已发布迁移。
2. 在 `storage/db.rs` 的 `MIGRATIONS` 注册版本。
3. 增加「旧版本升级」「失败回滚」「幂等」测试。
4. 若涉及实体字段，同步 `storage/models.rs` 与前端 `types.ts`。

### 6.3 备份与恢复

- 迁移备份与应用数据同目录，不进入用户文档目录。
- 快照正文按 hash 校验；被篡改的快照读取时拒绝。
- 删除数据库不会删除 `.md`，只会丢失建议/会话/设置等元数据。

## 7. 安全实现

| 风险 | 措施 |
| --- | --- |
| API key 泄露 | Windows 凭据管理器；DB/JSON/日志无 key 列；界面仅显示状态 |
| 正文进入日志 | `security::redact` 按键名与模式脱敏；审计事件只记录摘要 |
| 提示注入 | 模型输出不执行；候选经长度、链接、数字、禁用词校验 |
| 越界写入 | `writeScope` 固定；Apply 校验 revision 与选区 hash |
| 过期补丁 | `stale` 状态 + 服务端拒绝 |
| 文件损坏 | 原子替换、失败回退、快照、冲突检测 |
| 前端越权 | Tauri capabilities 仅开放 `core:default` 与 `dialog:default` |

CSP：`default-src 'self'`，脚本仅允许同源，图片允许 `asset:` / `data:`，样式允许内联（CodeMirror 需要），连接仅允许 IPC。

## 8. 测试分层

| 层 | 位置 | 覆盖 |
| --- | --- | --- |
| Rust 单元/集成 | `src-tauri/src/**/tests`、`src-tauri/tests/` | 编码、原子保存、DB 迁移、状态机、偏移、Prompt、SSE、脱敏、10 MB 性能、快照重启 |
| 前端单元 | `tests/unit/` | 文本/大纲/Diff/错误/设置/工作区/建议取消竞态 |
| E2E | `tests/e2e/` | 启动、编辑保存、建议接受/拒绝/过期/取消、多候选、快照、主题、命令面板、Agent 引用 |
| 桌面 E2E | `scripts/desktop-e2e.mjs` | 真实 WebView2 + Rust：打开 CRLF 文档、编辑/撤销/保存、字节比对、快照、主题、专注模式、设置 |
| 黄金语料 | `tests/fixtures/markdown/` | 24 个样本的打开—不编辑—保存字节指纹 |

E2E 使用 `VITE_MOCK_BACKEND=true` + 本机 Chrome，仅验证 UI 与交互时序；Rust 后端由 `cargo test` 验证。Mock 不会进入生产构建。

`pnpm test:desktop` 使用 `src-tauri/tauri.e2e.conf.json` 构建隔离标识（`com.vesrio.app.e2e`）的 debug 应用，通过 WebView2 CDP 驱动真实 Rust 文件服务，并在结束时清理测试数据目录；debug 构建可通过 `VESRIO_SECRET_SERVICE` 使用一次性凭据条目，避免触碰真实 API Key。它不会替代干净主机安装/卸载验证。真实模型联调需用户自行提供 Key，并使用临时示例文档，避免发送未确认的书稿正文。

## 9. 版本与发布

- 版本号：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 保持一致。
- 发布产物：`src-tauri/target/release/vesrio.exe` 与 `bundle/nsis/Vesrio_<version>_x64-setup.exe`。
- 校验和：`node scripts/checksums.mjs` → `release/SHA256SUMS.txt`。
- 回滚与门禁：见 [release-checklist.md](./release-checklist.md)。
