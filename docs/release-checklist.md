# 发布检查单与回滚说明（V0.1）

> 版本：0.1.0 · 目标平台：Windows 11 x64 · 日期：2026-10-22  
> **当前结论：自动化门禁通过；人工/干净主机/真实用户门禁未执行，暂不可标记为正式发布。**

## 1. 发布信息

| 项 | 值 |
| --- | --- |
| 产品名 | Vesrio / 文屿 |
| 版本 | 0.1.0 |
| Bundle identifier | `com.vesrio.app` |
| 安装方式 | NSIS，currentUser（无需管理员） |
| 安装包 | `src-tauri/target/release/bundle/nsis/Vesrio_0.1.0_x64-setup.exe`（约 3.0 MB） |
| 主程序 | `src-tauri/target/release/vesrio.exe`（约 7.3 MB） |
| 校验和 | `release/SHA256SUMS.txt` |

生成/更新校验和：

```bash
pnpm tauri build
node scripts/checksums.mjs
```

## 2. 自动化门禁

| 检查 | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 前端类型 | `pnpm typecheck` | PASS | vue-tsc 无输出 |
| 前端 lint | `pnpm lint` | PASS | eslint 无输出 |
| 前端单测 | `pnpm test` | PASS | 7 文件 / 33 tests |
| 前端构建 | `pnpm build` | PASS | 1779 modules，dist 生成 |
| E2E | `pnpm exec playwright test` | PASS | 16 tests（Chrome + mock 后端） |
| Rust 格式 | `cargo fmt --check` | PASS | 无 diff |
| Rust lint | `cargo clippy --all-targets -- -D warnings` | PASS | 0 warning |
| Rust 测试 | `cargo test` | PASS | 64 lib + 3 golden + 3 performance = 70 |
| 黄金语料 | `node scripts/check-golden.mjs` | PASS | 24 samples |
| 性能（后端） | `cargo test --test performance ten_megabyte -- --nocapture` | PASS | 10 MB open 714 ms / no-edit save 701 ms |
| 性能（前端） | `pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS | 50k 插入 27.8 ms / 40 次跳转 38.7 ms |
| 许可证 | `node scripts/check-licenses.mjs` | PASS | 794 packages，0 violation |
| 安装包构建 | `pnpm tauri build` | PASS | NSIS 2.96 MiB |
| 启动冒烟（未安装） | 直接运行 `src-tauri/target/release/vesrio.exe` 8 秒 | PASS | 进程存活；创建 `%APPDATA%\com.vesrio.app\{vesrio.db,snapshots,logs}` |
| 桌面 E2E（真实 Tauri） | `pnpm test:desktop` | PASS | 20 checks：打开/编辑/撤销/保存、CRLF 字节比对、外部冲突、快照恢复、风格卡、AI 未配置失败安全、主题/专注/设置 |
| NSIS 安装/启动/卸载（临时目录） | `Vesrio_0.1.0_x64-setup.exe /S /D=%TEMP%\vesrio-install-test` | PASS | 安装退出 0；安装后进程存活；卸载退出 0；安装目录移除；用户 `.md` 存在且 SHA-256 不变 |
| 生产包不含 mock | `rg "mockInvoke|VITE_MOCK_BACKEND" dist/assets` | PASS | 无匹配 |

> E2E 使用开发 mock 后端，验证 UI 状态机与时序；真实 Rust 命令由 `cargo test` 覆盖。二者不能互相替代。

## 3. 人工门禁（部分执行）

### 3.1 已在开发机执行（临时目录，非干净主机）

- [x] NSIS 静默安装到 `%TEMP%\vesrio-install-test`，退出码 0。
- [x] 安装后的 `vesrio.exe` 启动并存活 6 秒。
- [x] 运行 `uninstall.exe /S`，退出码 0，安装目录被移除。
- [x] 安装在安装目录外的用户 `.md` 未被删除，SHA-256 不变。
- [x] 卸载后无 Vesrio 开始菜单/桌面快捷方式残留，无 HKCU 卸载项残留。

### 3.2 仍需在干净 Windows 11 主机/VM 执行


在干净 Windows 11 x64 主机/VM 上逐项执行并记录系统版本、日志路径与截图：

- [ ] 安装包可双击安装，SmartScreen 行为符合预期（当前未签名）。
- [ ] 首次启动创建 `%APPDATA%\com.vesrio.app`，无崩溃。
- [ ] 打开 24 个黄金样本中的全部文件，逐个执行「打开—不编辑—保存」，用外部工具比对字节。
- [ ] 旅程 1：离线新建/编辑/保存/重开，内容不变。
- [ ] 旅程 2：选中中文段落请求精简，查看 Diff；拒绝不写入；接受后 `Ctrl+Z` 还原。
- [ ] 旅程 3：生成期间编辑原文，旧建议显示过期且无法接受。
- [ ] 旅程 4：配置风格卡 → 发起请求；Agent 回答引用可点击回跳。
- [ ] 旅程 5：外部修改文件后保存，出现冲突；分别验证重载/保留/另存。
- [ ] 旅程 6：配置真实模型服务但关闭 AI 时，纯编辑保存一切正常。
- [ ] 断网/错误 Base URL/401/500：有可见错误，正文不变。
- [ ] 创建快照 → 修改 → 恢复；关闭应用重启后快照仍存在。
- [ ] GBK/UTF-16 文件：提示转换，不静默写盘；显式转换后保存为 UTF-8。
- [ ] 卸载应用：用户 `.md` 未被删除；应用数据按预期保留。
- [ ] 升级：安装新版本覆盖旧版本，数据库迁移成功，会话/风格/快照可读。
- [ ] 至少 3 个真实长文档（≥ 5,000 字）试用，记录输入/滚动主观流畅度与 P0/P1 缺陷。
- [ ] 无障碍抽查：仅键盘完成打开、编辑、请求建议、接受、关闭；深浅色对比度检查。

## 4. 回滚说明

### 4.1 回滚应用版本

1. 卸载当前版本（控制面板 → 应用 → Vesrio）。
2. 安装上一版 `Vesrio_<old>_x64-setup.exe`。
3. 若新版本已执行数据库迁移，旧版本可能无法读取新 schema。此时：
   - 关闭应用；
   - 备份当前 `%APPDATA%\com.vesrio.app\vesrio.db`；
   - 找到迁移前备份 `vesrio.db.bak-v<old>-<timestamp>`，复制回 `vesrio.db`；
   - 启动旧版本验证。
4. 用户 `.md` 正文不受版本回滚影响。

### 4.2 回滚单次内容

- 应用内「修订」→ 选择快照 →「恢复」→ 检查 → `Ctrl+S`。
- 恢复前会自动创建 `before_restore` 快照，可再次回滚。

### 4.3 回滚配置/凭据

- 模型配置：设置页重新填写；API Key 需重新输入（凭据管理器不随数据库回滚）。
- 彻底重置：卸载后删除 `%APPDATA%\com.vesrio.app`。**先确认 `.md` 文件位置，切勿删除用户文档。**

### 4.4 安装包完整性

```bash
certutil -hashfile Vesrio_0.1.0_x64-setup.exe SHA256
```

与 `release/SHA256SUMS.txt` 对照；不一致时不要安装。

## 5. Go / No-Go

| 条件 | 状态 |
| --- | --- |
| 自动化门禁全绿 | ✅ |
| 安装/升级/卸载干净主机验证 | ⬜ 未执行 |
| Windows 11 桌面六条旅程 | ⬜ 未执行 |
| 真实模型服务联调 | ⬜ 未执行 |
| ≥ 3 个真实长文档内测 | ⬜ 未执行 |
| P0 缺陷清零 | ⬜ 待内测确认 |
| 安装包签名 | ⬜ 未执行 |

**No-Go**，直到第 3 节与第 5 节未完成项全部有签字/记录。完成后再将本文结论改为 Go，并更新 WBS 的 VES-049/050/054 状态。
