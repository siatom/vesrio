<div align="center">

# 文屿 · Vesrio

**为文字留一座岛。**

`Windows 11` · `Tauri 2` · `Vue 3` · `CodeMirror 6` · `v0.1.0`

[English](./README.md) · [简体中文](./README.zh-CN.md)

</div>

> **你的文字，你的声音。**

Vesrio 是一款本地优先的 Markdown 写作桌，落在 Windows 11 上。它不催促，也不代言；只是把光标、句子，和一段随时可以拒绝的建议，安静地放在同一张桌上。

大多数 AI 写作工具从空白页开始，以别人的口吻结束。Vesrio 从写作真正发生的地方开始：在你已经选定的那一句里，在一张你愿意久坐的桌前。你直接写。想有人陪读时，选中一段，开口问。模型给出的是候选，不是结论；在你点头之前，纸面不会被惊动。

## 一、前提

**作者握笔。** 编辑区是主路，对话是侧门。写作不是一段等待补全的提示词。

**建议是客。** 行内 AI 只触碰你划定的选区。每个候选都以差异的形式出现，停在句子旁边；被拒绝时，不留痕迹。接受只需一次决定，反悔只需一步撤销。

**昨日的补丁，不落今日的纸。** 如果模型思考时原文已经改变，建议会被标记为过期并拒绝应用。再漂亮的句子，放错位置也是损伤。

**文件比应用活得久。** 你的 `.md` 始终是可被任何编辑器打开的纯 Markdown——没有私有标记，没有锁定。Vesrio 自己的记忆（会话、风格、快照）住在文字旁边，而不是文字里面。

## 二、V0.1 已有的部分

- **会消失的界面。** CodeMirror 6 编辑，实时预览与源码模式，大纲、标签页、专注与审阅模式、深浅主题，以及可调的版心与字号。
- **贴着句子发生的行内 AI。** 浮动工具栏或 `Ctrl + J` 触发精简、润色、改写；一次生成 1～3 个候选；差异对照；接受、拒绝、切换，一步撤销。过期建议会被阻断。
- **只读的同行者。** 侧栏对话中的引用可跳回正文，会话按文档保存，项目风格卡约束语气与用词。它不获得写入权限。
- **有分寸的记忆。** 原子保存、外部修改冲突处理、接受与恢复前的快照、Windows 凭据管理器保存 API Key、脱敏日志。
- **真正能安装的桌面应用。** SQLite 迁移、统一错误码、Windows x64 NSIS 安装包。

## 三、诚实的进度

V0.1 功能已完整，自动化验证已覆盖：24 份黄金 Markdown 字节保真语料、过期补丁竞态、AI 失败安全路径、Rust 合同测试，以及真实 WebView2 桌面 E2E。

仍待完成：干净 Windows 主机上的完整流程、升级迁移、安装包代码签名，以及真实长篇作者的内测。细节见[已知问题](./docs/known-issues.md)与[发布检查单](./docs/release-checklist.md)。与其假装最后一公里已经走完，不如把路标如实立在这里。

## 四、它选择不做的事

不上云，不设账号，不做遥测，不做多人协作，不做移动端；不自动重写全篇，不做跨文档 RAG，不自动发布。

这些不是待填的空白，而是产品的轮廓。注意力是稀缺之物，写作桌不该与写作者争夺它。

## 五、技术栈

| 层 | 方案 |
| --- | --- |
| 桌面容器 | Tauri 2 / Rust |
| 界面 | Vue 3 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 |
| 状态 | Pinia |
| 元数据 | SQLite（rusqlite，bundled） |
| 凭据 | Windows Credential Manager（keyring） |
| 模型访问 | OpenAI-compatible HTTP + SSE（reqwest / rustls） |
| 工程 | pnpm + Cargo |

Vesrio 可连接任何 OpenAI-compatible 服务。默认预设为 DeepSeek Flash（`deepseek-flash`），也可切换 OpenAI 或填写自定义 Base URL。

## 六、环境要求

- Windows 11 x64（开发机需 WebView2 Runtime）。
- Node.js ≥ 20，pnpm 11。
- Rust stable（MSVC toolchain）与 Visual Studio Build Tools（C++ 桌面开发）。
- 仅运行打包后的应用，不需要 Node/Rust。

## 七、第一次点亮

```bash
pnpm install
pnpm dev          # 仅前端（浏览器；无桌面能力）
pnpm tauri:dev    # 真正的写作桌
pnpm build        # 类型检查 + 生产构建
pnpm tauri:build  # Windows NSIS 安装包
```

安装包输出：`src-tauri/target/release/bundle/nsis/Vesrio_0.1.0_x64-setup.exe`。

## 八、在信任它之前

```bash
# 前端
pnpm typecheck
pnpm lint
pnpm test                 # Vitest 单元测试
pnpm test:e2e             # Playwright E2E（本机 Chrome + mock 后端）
pnpm test:desktop         # 真实 Tauri/WebView2 桌面 E2E
pnpm build

# Rust（在 src-tauri 下）
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# 内容与交付
pnpm check:golden         # 24 个黄金 Markdown 样本字节指纹
pnpm check:licenses       # 生成 docs/licenses-report.md
pnpm checksums            # 生成 release/SHA256SUMS.txt
```

> E2E 使用 `src/lib/mockBackend.ts`（仅 DEV + `VITE_MOCK_BACKEND=true`）验证界面与交互时序，**不能替代 Rust 后端与真实模型的验收**。Rust 合同、文件保真和性能由 `cargo test` 覆盖。

## 九、文字住在哪里

- 用户 `.md` 文件不写入应用私有标记；无编辑保存不写盘。
- 应用数据默认位于 `%APPDATA%\com.vesrio.app`：
  - `vesrio.db`：项目、会话、建议、风格、快照索引、审计事件。
  - `snapshots/`：快照正文副本。
  - `logs/`：脱敏日志。
- API Key 只保存在 Windows 凭据管理器（service `com.vesrio.app`），SQLite 与日志中不存在明文 key。
- 发送给模型前，界面展示外发范围与字符数；项目之间不会静默携带正文。
- 卸载应用不会删除用户源 `.md`；是否清理应用数据由用户决定。

## 十、仓库地图

```text
src/                     Vue UI、编辑器、状态、行内 AI、Agent、设置
src-tauri/src/           Tauri commands、document、storage、provider、suggestion、security
src-tauri/migrations/    SQLite 迁移
tests/unit/              前端单元测试
tests/e2e/               Playwright E2E
tests/fixtures/markdown/ 黄金 Markdown 语料与指纹
scripts/                 黄金校验、许可证、校验和
docs/                    PRD、开发计划、WBS、ADR、用户与发布文档
```

## 十一、延伸阅读

- [用户指南](./docs/user-guide.md)
- [技术参考（命令/数据模型/迁移）](./docs/technical-reference.md)
- [安全与隐私审计](./docs/security-audit.md)
- [已知问题与限制](./docs/known-issues.md)
- [发布检查单与回滚](./docs/release-checklist.md)
- [第三方许可证报告](./docs/licenses-report.md)
- [架构决策记录](./docs/adr/README.md)
- [产品需求](./docs/prd.md) · [开发计划](./docs/development-plan.md) · [WBS](./docs/wbs.md)

## 十二、许可

Vesrio 以 [MIT License](./LICENSE) 发布。第三方依赖许可证清单见 [docs/licenses-report.md](./docs/licenses-report.md)。

---

<div align="center"><sub>慢慢写，留住你的声音。</sub></div>
