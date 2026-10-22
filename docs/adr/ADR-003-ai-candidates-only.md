# ADR-003：AI 只产出候选，接受才写入

- 状态：Accepted
- 日期：2026-10-22
- 关联：P-010、VES-028、VES-029、VES-033

## 背景

自动应用模型输出会直接破坏作者控制权，且失败重试、流式中断、重复点击都可能造成重复写入或半截文本。

## 决策

1. 生成结果是 `Suggestion`，状态机为 `generating → ready → accepted / rejected / stale / failed / canceled`。
2. 流式文本只进入内存预览，不触碰编辑器文档；取消、超时、网络错误一律不产生编辑事务。
3. 只有用户点击「接受」（或建议卡焦点下按 Enter）才调用受限 Apply Service。
4. `accept` 幂等：已 `accepted` 的建议再次请求返回 `alreadyApplied`，不重复插入。
5. 接受前自动创建快照；接受后一次 `Ctrl+Z` 可完整撤销。
6. 拒绝、关闭、取消均不修改正文。

## 后果

- 需要持久化建议与候选，并强制合法状态转移；数据库层拒绝非法转移。
- 前端接受后必须比对「编辑器实际文本」与「服务端预期 newText」，不一致时立即撤销。

## 验证

- 状态机与幂等：`src-tauri/src/storage/db.rs`、`suggestion/service.rs` 测试。
- E2E：接受仅改目标、拒绝逐字节不变、多候选切换、取消不写入（`tests/e2e/editor-ai.spec.ts`）。
