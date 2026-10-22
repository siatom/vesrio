# ADR-005：编辑器与模型解耦，模型无写权限

- 状态：Accepted
- 日期：2026-10-22
- 关联：P-030、VES-021、VES-024、VES-041

## 背景

不同模型服务的流式格式、错误码和能力差异很大；把厂商 SDK 或工具调用直接嵌进编辑器会扩大攻击面，也会让替换模型变得困难。

## 决策

1. Rust `provider/client.rs` 实现 OpenAI-compatible HTTP 适配器（自定义 base URL、模型名、超时、temperature、max tokens）。
2. 模型输出只作为不可信文本解析：先剥离代码围栏，再按候选分隔符切分，校验长度、链接、数字与禁用词。
3. 不执行模型返回的任何指令、HTML、脚本或工具调用；提示注入文本只作为候选内容展示或被拒绝。
4. API key 由 Rust 从 Windows 凭据管理器读取，前端只得到 `hasApiKey` 布尔值。
5. 网络失败映射为稳定错误码（`provider_error`、`cancelled`、`not_configured`），并释放请求与流。

## 后果

- 新增厂商只需兼容 OpenAI Chat Completions 协议，或在适配器内做转换。
- 输出校验可能拒绝部分合法但格式异常的候选，这是有意的失败安全策略。

## 验证

- 受控假服务器/错误映射测试：`src-tauri/src/provider/client.rs`。
- 注入与候选清洗测试：`src-tauri/src/suggestion/prompt.rs`。
- E2E 错误路径：`tests/e2e/agent.spec.ts`。
