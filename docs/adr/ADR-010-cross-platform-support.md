# ADR-010：V0.2 跨平台支持与平台边界

- 状态：Accepted（2026-10-22 负责人确认）
- 日期：2026-10-22
- 关联：VES-055～VES-071、[V0.2 跨平台里程碑计划](../v0.2-cross-platform-plan.md)
- 补充：[ADR-008](./ADR-008-atomic-save-and-secrets.md)（Windows 原子保存与凭据）

## 背景

V0.1 明确以 Windows 11 x64 首发，现有实现也围绕 Windows 验证：保存使用 `ReplaceFileW`，凭据只启用 `windows-native`，打包目标只有 NSIS。代码层面多数逻辑是平台中立的，但 macOS/Linux 仍存在直接阻断与静默失效：

- keyring 在未启用对应后端时会退化为无持久化的 mock；
- `tauri build` 的 NSIS 目标在非 Windows 平台不可用；
- Unix 的 `rename` 保存不保留原文件权限，也没有目录 fsync 与后端只读校验；
- 桌面 E2E、校验和与文档均以 Windows 为前提。

负责人决定将跨平台作为 **V0.2 独立里程碑**，不并入 V0.1，也不与写作功能扩张混做。

## 决策

1. **支持矩阵**：V0.2 一级支持 Windows 11 x64（含 Windows 10 回归）、macOS 13+（universal2）、Ubuntu 22.04/24.04 LTS x64。Fedora 为二级 best effort；Windows/Linux ARM64、WSL、无桌面 Linux、移动端与 Web 版不在范围内。最终矩阵以计划文档 §2 为准。
2. **构建方式**：每个平台使用原生 runner 构建，不采用交叉编译发布；Windows 产出 NSIS，macOS 产出 dmg/app，Linux 产出 deb/AppImage。所有产物必须来自同一提交。
3. **凭据后端**：API Key 只写入各平台原生凭据库（Windows Credential Manager、macOS Keychain、Linux Secret Service）。禁止明文文件、SQLite、日志或内存 mock 作为发布路径的降级方案；后端不可用时返回可操作的错误并禁用 AI 调用。调试/测试用的内存 store 必须与生产路径隔离。
4. **Unix 保存语义**：在保留“同目录临时文件 → fsync → 原子替换”的前提下：
   - 替换前复制原文件的权限位（至少 mode），所有者无法保留时明确报错或降级说明；
   - 替换后对父目录执行 fsync，补足断电持久性；
   - Rust 命令层在保存前校验只读状态，不依赖前端拦截；
   - 符号链接先解析目标，硬链接与 xattr/ACL 的保留策略需文档化，不能静默声称已保留。

### VES-058 实现记录（2026-10-22）

- Unix 在 `rename` 前用原文件 `Permissions` 覆盖临时文件，保留 mode/read-only 位；临时文件由同一用户创建，owner 不变，group 可能随目录默认值变化。
- `rename` 后 best-effort fsync 父目录；文件数据已在替换前 `sync_all`。CI run 39800957041 在 macOS arm64 与 Ubuntu 22.04/24.04 通过权限、只读与符号链接测试。
- `DocumentStore::save` 与 `save_as` 在 Rust 层拒绝只读目标，返回 `permission_denied`；不依赖前端。
- `open` 通过 `canonicalize` 解析符号链接并写回真实目标，链接本身保留。
- 硬链接在替换后只更新目标目录项，其他链接仍指向旧 inode。
- ACL/xattr 不复制；需要完整元数据保真的场景不在 V0.2 承诺内。
- `save_as` 若直接指向一个符号链接路径，仍可能替换链接本身；统一处理留给 VES-060。
5. **平台 UI 适配**：快捷键文案按平台显示 `⌘` / `Ctrl`；macOS 使用系统菜单与窗口装饰约定，避免原生标题栏与自绘标题栏叠加；字体栈补齐 Linux CJK 回退。平台差异集中在适配层，不复制业务逻辑。
6. **验证策略**：三平台 CI 至少覆盖 typecheck/lint/test/build、Rust 检查、黄金样本与许可证；桌面 E2E 按平台能力选择方案（Windows WebView2 CDP、Linux WebDriver、macOS 脚本化人工验收或后续替代方案）。未在目标系统实机执行的项只能标记 `Not Verified`。
7. **范围边界**：V0.2 只做平台化，不新增写作功能。PRD 5.5 原有的 V0.2 SHOULD 功能顺延为 V0.3 候选，需随本 ADR 一并确认。V0.1 的 Windows 行为与验收标准不变。

## 确认记录

2026-10-22 负责人确认以下默认值：

1. macOS 13+，universal2。
2. Linux 一级支持 Ubuntu 22.04/24.04 LTS x64，发行物为 deb + AppImage。
3. macOS 桌面 E2E 在 V0.2 采用脚本化人工验收，自动化列为技术债。
4. 凭据后端不可用时明确报错并禁用 AI，不降级到明文或内存 mock。
5. 原 PRD 5.5 的 V0.2 SHOULD 功能顺延 V0.3。
6. Windows 代码签名作为共享发布门禁；证书具备则签，否则在已知问题中披露。

## 后果

### 正面

- macOS/Linux 用户获得与 Windows 一致的保存、凭据与退出保护。
- 平台差异有明确归属，避免在业务代码中散落 `cfg` 分支。
- 三平台构建与发布有可审计证据，降低“本机能跑”的假通过风险。

### 代价与限制

- 新增 macOS 签名/公证证书、CI runner 与构建时间成本。
- Linux 依赖 D-Bus Secret Service；精简或无桌面环境不支持 AI 凭据。
- universal2 与三平台产物增大发布体积。
- macOS 桌面 E2E 在 V0.2 可能无法自动化，需要人工检查单补足。
- Unix 的 ACL/xattr 与硬链接语义无法完全等价于 Windows，需以文档和快照兜底。

## 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 维持 Windows-only | 不采纳 | 与跨平台产品目标冲突 |
| 用 Electron 重写 | 不采纳 | 推翻现有 Tauri/Rust 数据安全实现，成本与风险过高 |
| 交叉编译三平台 | 不采纳 | Tauri/WebView 原生依赖无法可靠交叉构建与验证 |
| 用明文文件保存 API Key 作为兜底 | 不采纳 | 违反 P-305 / N-07 与 ADR-008 |
| 在 V0.2 同时做写作功能 | 不采纳 | 平台化本身已有数据安全风险，混合会扩大回归面 |
| macOS 未签名分发 | 不采纳 | Gatekeeper 会阻断普通用户安装 |

## 验证

- 计划文档：`docs/v0.2-cross-platform-plan.md`。
- 任务与门禁：`docs/wbs.md` E7 与 V0.2 里程碑。
- 实现后需补充：三平台凭据“保存→重启→读取”记录、Unix 权限保持测试、黄金样本回环、签名/公证结果、安装/卸载记录。
- 本文档已于 2026-10-22 获批，状态为 `Accepted`；后续变更需新增 ADR 或在本文件追加修订记录。
