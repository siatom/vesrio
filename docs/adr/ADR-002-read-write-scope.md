# ADR-002：读取范围与写入范围分离

- 状态：Accepted
- 日期：2026-10-22
- 关联：P-020、VES-026、VES-040

## 背景

Agent 需要理解上下文才能给出高质量建议，但「能读全文」不等于「能改全文」。若把两者混为一个权限，模型输出或提示注入可能扩大修改范围。

## 决策

1. `readScope` 可为 `selection`、`selection_with_paragraph_context`、`document`，由用户在请求前选择；界面展示外发字符数与范围。
2. 行内建议的 `writeScope` 恒为 `selection_only`；Agent 对话恒为 `none`。
3. 模型没有文件系统工具、Shell 或数据库写权限，只能返回结构化文本。
4. 接受建议时，Editor Core 只对 `anchor` 指定的 UTF-16 范围生成一次事务。
5. 扩大读取范围必须由用户显式操作；不因当前文档属于某项目而静默携带其它文档内容。

## 后果

- 需要维护请求合同中的 `readScope` / `writeScope` 字段，并在服务端与前端双重校验。
- 接受操作必须校验选区 hash，避免把模型返回的文本当作可执行指令。

## 验证

- Rust 侧请求构造与权限字段测试：`src-tauri/src/suggestion/prompt.rs`、`service.rs` 单元测试。
- 隐私预览 UI：行内 AI 对话框在发送前显示外发范围与字符数。
