# 安全与隐私审计（V0.1）

> 审计日期：2026-10-22 · 版本 0.1.0  
> 结论：自动化检查未发现 P0/P1 级安全缺陷；存在 3 项中低风险残留，见第 6 节。安装包未签名、干净主机与真实用户验证未执行。

## 1. 范围与资产

| 资产 | 位置 | 风险 |
| --- | --- | --- |
| 用户 Markdown 正文 | 用户选择的任意本地路径 | 丢失、损坏、静默改写、越权外发 |
| API Key | 系统凭据库（Windows Credential Manager / macOS Keychain / Linux Secret Service） | 明文落盘、日志泄露、前端读取、后端静默降级 |
| 建议/会话/风格/快照 | `%APPDATA%\com.vesrio.app` | 跨文档串扰、越权持久化 |
| 模型请求 | 用户配置的 Base URL | 超出授权范围发送、注入 |
| 安装包与依赖 | `src-tauri/target/release/bundle` | 供应链、未签名分发 |

## 2. 隐私边界

1. **正文真源**：`.md` 文件不被注入私有标记；未编辑保存不写盘。
2. **外发范围**：行内建议可选 `selection` / `selection_with_paragraph_context` / `document`；发送前显示完整外发文本与字符数（默认开启确认）。
3. **写入边界**：建议 `writeScope = selection_only`，Agent `writeScope = none`；模型无文件/Shell/数据库工具。
4. **项目隔离**：会话、建议、风格按 document/project 持久化；请求只携带当前文档与当前项目风格，不静默拼接其它文档。
5. **无遥测**：应用不包含分析 SDK、崩溃上报或自动更新网络请求；唯一出站请求是用户配置的模型服务。

## 3. 凭据与日志

### 3.1 API Key

- 存储：`provider::secrets::KeyringStore` → 按平台选择原生凭据库：Windows Credential Manager、macOS Keychain、Linux Secret Service；service `com.vesrio.app`，account `provider-default`。
- 后端不可用：`get_provider_config` 返回 `credentialBackend` 与 `credentialError`，设置页显示可操作错误并禁用连接测试；不降级到明文文件、SQLite 或内存 mock。
- 测试隔离：仅 debug 构建允许用 `VESRIO_SECRET_SERVICE` 指向一次性 service，桌面 E2E 不读取/覆盖真实 Key；release 构建忽略该环境变量。真实后端回归测试使用 `KeyringStore::with_service` 的一次性 service。
- SQLite 的 `provider_configs` 表无 key 列；`get_provider_config` 只返回 `hasApiKey` 与后端状态，不返回 key。
- 前端输入框为 `type="password"`，保存后清空；界面按平台显示「已安全保存」。
- 清除 Key：设置页「移除 API Key」调用 `delete_credential`。
- 保存顺序：先写凭据库，成功后才写入 provider 配置；凭据库失败时配置不变。

证据：

```text
src-tauri/migrations/0001_init.sql  provider_configs: base_url, model, timeout_ms,
                                    temperature, max_tokens, updated_at（无 key 列）
src-tauri/src/provider/secrets.rs   keyring::{set_password,get_password,delete_credential}
src-tauri/tests/keyring_roundtrip.rs  真实后端 roundtrip（显式 --ignored 运行）
src-tauri/src/storage/models.rs     ProviderConfigView: has_api_key, credential_backend,
                                    credential_error
```

验证状态：Windows Credential Manager roundtrip 已通过（2026-10-22）；macOS Keychain 与 Linux Secret Service 待实机验证（VES-057/068）。

### 3.2 日志脱敏

`security::redact`：

- 键名包含 `key`、`secret`、`token`、`authorization`、`password`、`content`、`text`、`document`、`prompt`、`message` 的字段整体替换为 `[REDACTED]`。
- 自由文本匹配 `sk-...`、`Bearer ...`、`api_key=...`、`Authorization: ...` 后替换。
- 日志与审计事件都先经过该函数；审计只写事件名、请求 id、字符数、状态等元数据。

证据：

```text
src-tauri/src/security/redact.rs  redacts_common_key_shapes
                                  redacts_sensitive_json_keys_and_nested_strings
src-tauri/src/security/logger.rs  写入前 redact_json + redact_text
```

## 4. 攻击面与控制

| 威胁 | 控制 | 验证 |
| --- | --- | --- |
| 提示注入执行命令 | 模型输出只按文本解析；剥离代码围栏、校验候选；无工具调用 | `suggestion/prompt.rs` 单元测试 |
| 越界写入 | 接受前校验 revision + 选区 SHA-256；只替换 anchor 范围；前端比对 `newText` 后不一致即撤销 | `suggestion/service.rs`、`tests/e2e/editor-ai.spec.ts` |
| 过期补丁 | `stale` 状态 + 服务端拒绝 | 同上 |
| 重复接受 | 状态机 + `alreadyApplied` 幂等 | `repeated_apply_is_idempotent` |
| 文件损坏 | 临时文件 + 平台原子替换（Windows `ReplaceFileW` / Unix `rename` + 权限保留）；失败保留原文件；快照 | `document/atomic.rs`、`store.rs` |
| 外部修改覆盖 | 保存校验 `diskHash`；冲突返回可选处理 | `external_conflict` 测试 |
| 快照路径穿越 | 文档 id 清洗 + 快照根目录校验 | `document_ids_cannot_escape_snapshot_root` |
| WebView 任意网络/脚本 | CSP：脚本同源、连接仅 IPC；模型请求在 Rust | `tauri.conf.json` |
| 前端越权调用 | capabilities 仅 `core:default`、`dialog:default` | `capabilities/default.json` |
| 日志泄露正文/key | 键名与模式脱敏 | 脱敏单测 |
| 依赖许可证风险 | `scripts/check-licenses.mjs` 白名单审计 | 见第 5 节 |

## 5. 依赖与许可证

```text
$ node scripts/check-licenses.mjs
wrote docs/licenses-report.md (794 packages, 0 violation(s))

Node packages: 317
Rust crates:   477
Result: PASS — all licenses are on the allowlist
```

- 清单覆盖直接与传递依赖、开发依赖与目标平台条件依赖。
- 允许 MIT、ISC、BSD-2/3、Apache-2.0、MPL-2.0（未修改）、CC0、Unlicense、Zlib、BSL-1.0、BlueOak-1.0.0、Python-2.0、CDLA-Permissive-2.0、Unicode-3.0 及等价组合。
- `MPL-2.0` 依赖未修改，不改变 Vesrio 自身源码许可。
- 完整包清单：[licenses-report.md](./licenses-report.md)。

生产构建未包含开发 mock：`dist/assets/*.js` 中不存在 `mockInvoke` / `VITE_MOCK_BACKEND` / mock 文案。

## 6. 残留风险

| 级别 | 风险 | 说明 | 建议 |
| --- | --- | --- | --- |
| 中 | 安装包未签名 | SmartScreen 可能拦截，用户无法验证发布者 | 发布前签名并公布 SHA-256 |
| 中 | 快照与应用数据未加密 | 本机其它账户/恶意软件可读取快照正文 | 依赖 Windows 用户目录 ACL；高敏感场景建议 BitLocker |
| 中 | 模型服务由用户配置，允许 `http://` | 明文传输可能导致正文与 key 在局域网被截获 | 文档建议使用 HTTPS；后续可限制非 localhost 的明文地址 |
| 低 | 日志仍含路径/请求元数据 | 已脱敏正文与 key，但路径可能暴露项目名 | 分享日志前人工检查 |
| 低 | 提示注入可影响候选内容 | 写入被阻断，但候选可能包含误导文本 | 保持 Diff 审阅；后续增加可见的「不可信内容」标记 |
| 低 | 无自动更新 | 旧版本可能缺少安全修复 | 发布页提供版本与校验和，用户手动升级 |

## 7. 复核命令

```bash
# 凭据/数据库表检查
rg -n -i "api[_-]?key" src-tauri/migrations

# 脱敏与状态机测试
cd src-tauri && cargo test security:: suggestion::storage::db

# 许可证
pnpm check:licenses

# 生产包不含 mock
pnpm build && rg "mockInvoke|VITE_MOCK_BACKEND" dist/assets || echo "absent"

# 校验和
pnpm checksums
```
