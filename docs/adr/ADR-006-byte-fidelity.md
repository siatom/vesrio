# ADR-006：文本事务优先，不做高风险格式往返

- 状态：Accepted
- 日期：2026-10-22
- 关联：VES-010、VES-012、VES-018

## 背景

把 Markdown 解析为富文本 AST 再序列化，容易在未知语法、表格对齐、HTML 块、脚注和行尾空格上产生非预期改写。创作工具不能因为「渲染漂亮」而改动作者未触及的字节。

## 决策

1. 编辑器直接持有 Markdown 文本；CodeMirror 装饰只影响显示，不改变文档字符串。
2. 实时预览通过 `Decoration.replace` 隐藏语法标记，源码模式关闭装饰；两种模式共享同一文本。
3. 保存时只提交编辑器文档字符串，不在保存路径重新格式化。
4. 无编辑（`dirty = false`）的保存直接返回 `wrote = false`，不触碰磁盘。
5. 若未来引入富文本中间表示，必须先证明未编辑区域字节保真，并新增 ADR 取代本决策。

## 后果

- 表格、代码围栏、Front Matter 等结构保持原样，即使视觉呈现不完美。
- 某些 Markdown 扩展无法获得所见即所得效果，这是可接受的取舍。

## 验证

- 黄金样本指纹：`tests/fixtures/markdown/FINGERPRINTS.json`、`scripts/check-golden.mjs`。
- 实时预览/源码模式：`tests/e2e/shell.spec.ts`。
