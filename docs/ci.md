# 持续集成（CI）说明

> 对应任务：VES-066｜更新：2026-10-22
>
> 工作流：`.github/workflows/ci.yml`

## 1. 目标与边界

CI 负责证明“同一提交在三个平台上至少可安装依赖、通过质量门禁并完成编译”，不作为发布流水线。

覆盖：

- 前端：`typecheck`、`lint`、单元测试、构建；
- Rust：`fmt`、`clippy -D warnings`、单元/集成/黄金测试、编译；
- 黄金 Markdown 指纹与第三方许可证检查；
- 前端构建产物上传。

**不覆盖**（由后续任务负责）：

- 安装包构建与安装/卸载（VES-061）；
- macOS 签名、公证与 Gatekeeper 验证（VES-062）；
- 桌面 E2E、真实 WebView/WebKit 旅程（VES-067/068）；
- 三平台实机性能与长文档验收（VES-068）。

## 2. 平台矩阵

| Runner | 平台标识 | 覆盖目的 |
| --- | --- | --- |
| `windows-latest` | `windows-x64` | V0.1 回归基线；NSIS 目标平台 |
| `macos-15` | `macos-arm64` | Apple Silicon 编译；Keychain/WKWebView 目标平台 |
| `ubuntu-22.04` | `ubuntu-22.04` | Linux 一级支持基线 |
| `ubuntu-24.04` | `ubuntu-24.04` | Linux 一级支持基线 |

说明：

1. `macos-15` 为 arm64 runner；Intel/universal2 产物在 VES-061/062 处理。GitHub 已宣布 `macos-14` 于 2026-11-02 退役，因此不使用该标签。
2. Linux 任务安装 Tauri 2 所需的 WebKitGTK 4.1、AppIndicator、librsvg、patchelf 与 D-Bus 开发依赖（后者供 Secret Service 凭据后端编译）。
3. 任一平台失败不会取消其他平台（`fail-fast: false`），便于一次看到全部差异。
4. 同一 PR 的新提交会取消旧运行（`concurrency`）。

## 3. 本地复现

CI 的每一步都可以在本地按顺序执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
node scripts/check-golden.mjs
node scripts/check-licenses.mjs --check

cd src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo build --locked
cd ..

pnpm build
```

Windows 桌面烟测仍是独立命令：`pnpm test:desktop`（VES-067 会按平台改造）。

## 4. 触发与证据

- 触发：推送到 `main`、任意 Pull Request、手动 `workflow_dispatch`。
- 必需检查：在分支保护中要求四个矩阵任务全部通过，状态名形如 `CI / windows-x64`、`CI / ubuntu-24.04`。
- 产物：每次运行上传 `vesrio-web-<platform>`（`dist/`），保留 7 天。
- 通过判定：只有当对应平台的实际运行日志为绿色时，才能把 V0.2 相关任务标为 `Done`；仅本地通过不等于 CI 通过。

### 4.1 首次运行记录

| 日期 | 提交 | 运行 | 结果 |
| --- | --- | --- | --- |
| 2026-10-22 | `e2df108` | [39794658980](https://github.com/siatom/vesrio/actions/runs/39794658980) | 四任务全部成功，15m22s |

- `windows-x64`：PASS
- `macos-arm64`：PASS
- `ubuntu-22.04`：PASS
- `ubuntu-24.04`：PASS
- 四个 `vesrio-web-*` 产物均已上传。

同一提交时间窗内的较早运行 `39794587669` 被并发策略取消，属于预期行为。

## 5. 已知限制

1. CI 不运行 Tauri 桌面窗口，不能替代实机走查。
2. macOS 无 CDP，桌面 E2E 仍按 VES-067 的脚本化人工验收执行。
3. Linux 依赖 `libwebkit2gtk-4.1-dev`；若未来支持更老发行版，需要单独矩阵和依赖声明。
4. CI 不启动 Keychain / Secret Service；凭据运行时与实机走查仍需 VES-057/068。
5. 证书、签名与公证凭据尚未配置，当前工作流不需要任何 secret。
