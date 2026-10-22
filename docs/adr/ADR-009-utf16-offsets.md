# ADR-009：UTF-16 偏移合同

- 状态：Accepted
- 日期：2026-10-22
- 关联：VES-023、VES-025、VES-034

## 背景

CodeMirror 与 JavaScript 字符串使用 UTF-16 code unit 偏移，Rust `String` 使用 UTF-8 字节索引。中文、emoji、组合字符和 CRLF 会让两套偏移产生差异；直接互用会截断字符或错位。

## 决策

1. 前后端合同中的 `fromUtf16` / `toUtf16` 明确表示 JS UTF-16 偏移，字段名带后缀，禁止传字节偏移。
2. Rust 边界集中在 `suggestion/anchor.rs`：
   - `utf16_to_byte` / `byte_to_utf16` 负责转换；
   - 越界、落在代理对中间、落在字符边界外一律返回 `invalid_input`；
   - 选区 hash 基于 UTF-8 字节计算，但范围由 UTF-16 转换得到。
3. 段落/上下文扩展也走同一转换函数，并在段落边界截断。
4. 前端只使用编辑器返回的偏移，不自行按 `length` 推算 Rust 偏移。

## 验证

- 中文、emoji（含 ZWJ family emoji）、组合字符、CRLF、空选区测试：`src-tauri/src/suggestion/anchor.rs`。
- 端到端 stale 与接受路径：`tests/e2e/editor-ai.spec.ts`。
