# ADR-004：过期补丁默认拒绝

- 状态：Accepted
- 日期：2026-10-22
- 关联：P-012、VES-030、VES-034

## 背景

模型生成需要时间，作者在此期间可能继续编辑。若按旧偏移直接套用候选，会把文字插到错误位置或覆盖新内容。

## 决策

1. 请求记录 `documentId`、`baseRevision`（编辑器内存修订号）、`fromUtf16` / `toUtf16` 与选区 SHA-256。
2. 服务端在 `apply` 前校验：
   - 文档 id 一致；
   - 当前 `editRevision` 等于建议的 `baseRevision`；
   - 当前文本在 anchor 范围内的内容 hash 等于 `selectedTextHash`。
3. 任一校验失败即将建议标记为 `stale` 并返回 `stale_suggestion`，不写入任何字符。
4. V0.1 不提供「自动重新定位后强行应用」；用户需重新生成或手动处理。
5. 生成完成时如果客户端 revision 已变化，前端主动标记 stale，而不是展示可接受状态。

## 后果

- 保守策略可能让用户在快速编辑后多做一次生成，但不会损坏文本。
- 模型返回的 `fromUtf16/toUtf16` 不被信任；服务端用请求时的 anchor 为准。

## 验证

- Rust 过期与 hash 校验：`src-tauri/src/suggestion/service.rs` 测试。
- E2E：生成完成后插入一行再接受，卡片变为「已过期」且正文只保留用户编辑（`tests/e2e/editor-ai.spec.ts`）。
