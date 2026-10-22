# 文屿 · Vesrio

**Your words. Your voice.** 你的文字，你的声音。

Vesrio 是一个作者主导、Agent 协同的 **Windows 11 本地 Markdown 写作应用**。作者直接编辑正文；行内 AI 只在选区上提出候选，必须经作者审阅并点击「接受」才会写入，且可一步撤销；过期补丁默认拒绝。Markdown 文件始终是正文唯一真源。

## 当前状态

V0.1 功能实现与自动化验证已完成：

- Markdown 打开/保存保真、原子写入、外部修改冲突处理、快照恢复。
- CodeMirror 6 编辑器、实时预览/源码模式、大纲、标签页、专注/审阅模式、深浅主题。
- 行内选区 AI：范围选择、隐私预览、流式候选、Diff 审阅、2～3 候选切换、接受/拒绝/撤销、过期阻断。
- Agent 只读对话、引用跳转、会话持久化、项目风格卡。
- SQLite 迁移、Windows 凭据管理器存 key、日志脱敏、统一错误码。
- Windows x64 NSIS 安装包可构建。

尚需真实设备/真实用户完成的事项见 [docs/known-issues.md](./docs/known-issues.md) 与 [docs/release-checklist.md](./docs/release-checklist.md)：
安装/升级/卸载的干净主机验证、Windows 11 桌面实机用户旅程、真实用户内测。

## 技术栈

| 层 | 方案 |
| --- | --- |
| 桌面容器 | Tauri 2 / Rust |
| UI | Vue 3 + TypeScript + Vite |
| 编辑器 | CodeMirror 6 |
| 状态 | Pinia |
| 元数据 | SQLite（rusqlite，bundled） |
| 凭据 | Windows Credential Manager（keyring） |
| 模型访问 | OpenAI-compatible HTTP + SSE（reqwest/rustls） |
| 工程 | pnpm + Cargo |

## 环境要求

- Windows 11 x64（开发机需 WebView2 Runtime）。
- Node.js ≥ 20，pnpm 11。
- Rust stable（MSVC toolchain）与 Visual Studio Build Tools（C++ 桌面开发）。
- 仅运行打包后的应用不需要 Node/Rust。

首次安装依赖：

```bash
pnpm install
```

## 开发

```bash
pnpm dev          # 仅前端（浏览器；无桌面能力）
pnpm tauri:dev    # 桌面开发模式
pnpm build        # 前端类型检查 + 生产构建
pnpm tauri:build  # Windows NSIS 安装包
```

安装包输出：`src-tauri/target/release/bundle/nsis/Vesrio_0.1.0_x64-setup.exe`。

## 测试与质量门禁

```bash
# 前端
pnpm typecheck
pnpm lint
pnpm test                 # Vitest 单元测试
pnpm test:e2e             # Playwright E2E（使用本机 Chrome + 开发 mock 后端）
pnpm build

# Rust（在 src-tauri 下）
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# 内容与交付
pnpm check:golden      # 24 个黄金 Markdown 样本字节指纹
pnpm check:licenses    # 生成 docs/licenses-report.md
pnpm checksums         # 生成 release/SHA256SUMS.txt
```

> E2E 使用 `src/lib/mockBackend.ts`（仅 DEV + `VITE_MOCK_BACKEND=true`）验证 UI 与交互时序，**不能替代 Rust 后端与真实模型的验收**。Rust 合同、文件保真和性能由 `cargo test` 覆盖。

## 目录

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

## 数据与隐私

- 用户 `.md` 文件不写入应用私有标记；无编辑保存不写盘。
- 应用数据默认位于 `%APPDATA%\com.vesrio.app`：
  - `vesrio.db`：项目、会话、建议、风格、快照索引、审计事件。
  - `snapshots/`：快照正文副本。
  - `logs/`：脱敏日志。
- API key 只保存在 Windows 凭据管理器（service `com.vesrio.app`），SQLite 与日志中不存在明文 key。
- 发送给模型前，界面展示外发范围与字符数；项目之间不会静默携带正文。
- 卸载应用不会删除用户源 `.md`；是否清理应用数据由用户决定。

## 文档

- [用户指南](./docs/user-guide.md)
- [技术参考（命令/数据模型/迁移）](./docs/technical-reference.md)
- [安全与隐私审计](./docs/security-audit.md)
- [已知问题与限制](./docs/known-issues.md)
- [发布检查单与回滚](./docs/release-checklist.md)
- [第三方许可证报告](./docs/licenses-report.md)
- [架构决策记录](./docs/adr/README.md)
- [产品需求](./docs/prd.md) / [开发计划](./docs/development-plan.md) / [WBS](./docs/wbs.md)

## 许可证

第三方依赖许可证清单见 [docs/licenses-report.md](./docs/licenses-report.md)。Vesrio 自身源码的许可方式由项目负责人另行确定，在明确前不视为开源授权。
