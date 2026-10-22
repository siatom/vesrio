# 架构决策记录（ADR）

本目录冻结 V0.1 的关键技术边界。除负责人明确批准的新 ADR 外，实现不得绕过这些决策。

| ADR | 主题 | 状态 |
| --- | --- | --- |
| [ADR-001](./ADR-001-markdown-as-source-of-truth.md) | Markdown 是正文唯一真源 | Accepted |
| [ADR-002](./ADR-002-read-write-scope.md) | 读写权限分离 | Accepted |
| [ADR-003](./ADR-003-ai-candidates-only.md) | AI 只产出候选，用户接受后才写入 | Accepted |
| [ADR-004](./ADR-004-stale-patch-rejection.md) | 过期补丁默认拒绝 | Accepted |
| [ADR-005](./ADR-005-editor-model-decoupling.md) | 编辑器与模型解耦，模型无写权限 | Accepted |
| [ADR-006](./ADR-006-byte-fidelity.md) | 文本事务优先，不做高风险格式往返 | Accepted |

补充实现决策（非冻结架构）：

- [ADR-007](./ADR-007-encoding-and-line-endings.md)：非 UTF-8 显式转换、混合换行处理。
- [ADR-008](./ADR-008-atomic-save-and-secrets.md)：原子保存与 Windows 凭据管理器。
- [ADR-009](./ADR-009-utf16-offsets.md)：跨 Rust/TS 的 UTF-16 偏移合同。

日期均为 2026-10-22。
