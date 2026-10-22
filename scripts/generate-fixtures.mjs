import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'tests', 'fixtures', 'markdown')
await mkdir(outDir, { recursive: true })

const BOM = '\uFEFF'

const samples = {
  '01-chinese-long.md': {
    text: `# 技术规范的精简与边界

## 1. 背景

构建适配需要对原有软件进行一定程度的调整。这种调整既包括编译参数的重新配置，也包括依赖库的替换，以及在部分操作系统上需要额外增加的兼容性处理。编写本规范的目的，是明确这些工作的边界与验收方式。

## 2. 原则

- 保持技术事实不变，不把条件性表述改成确定性承诺。
- 删除重复表达，但保留必要的约束和例外。
- 术语以项目风格卡为准，首次出现时给出解释。

## 3. 风险

如果为了追求简洁而删除限定条件，读者可能将「可能」理解为「一定」。这类改写必须由作者逐条确认，不能自动应用。
`,
    eol: 'lf',
  },
  '02-emoji.md': {
    text: `# Emoji 与组合字符

家庭成员表情：👩‍👩‍👧‍👦
旗帜：🇨🇳
职业：🧑‍💻
肤色修饰：👍🏽
键帽：1️⃣

这些字符在 UTF-16 中占两个或更多代码单元。锚点必须按 UTF-16 计算，Rust 侧按 UTF-8 字节处理，转换不能截断代理对。
`,
    eol: 'lf',
  },
  '03-crlf.md': {
    text: `# CRLF 文档

第一行使用 Windows 换行。
第二行仍然使用 CRLF。

- 项目符号一
- 项目符号二

保存时不应把 CRLF 改成 LF。
`,
    eol: 'crlf',
  },
  '04-bom.md': {
    text: `# 带 BOM 的文档

这是一份 UTF-8 BOM 文件。打开、不编辑、保存后必须逐字节一致。

| 列一 | 列二 |
| --- | --- |
| BOM | 保留 |
`,
    eol: 'lf',
    bom: true,
  },
  '05-frontmatter.md': {
    text: `---
title: 文屿测试文档
author: Vesrio
tags:
  - markdown
  - fidelity
date: 2026-10-22
unknown_field:
  nested: true
---

# 正文

Front Matter 必须原样保留，即使解析器不认识其中的字段。
`,
    eol: 'lf',
  },
  '06-gfm-table.md': {
    text: `# GFM 表格

| 能力 | 状态 | 说明 |
| :--- | :---: | ---: |
| 无损保存 | 必须 | 字节一致 |
| 表格渲染 | 支持 | GFM |
| 未知语法 | 保留 | 源码可见 |

表格单元格里的 \`code\` 和 **粗体** 不能被改写。
`,
    eol: 'lf',
  },
  '07-code-fence.md': {
    text: `# 代码围栏

\`\`\`rust
fn main() {
    // # 这一行看起来像标题，但不应该进入大纲
    println!("你好，文屿");
}
\`\`\`

嵌套围栏：

~~~~markdown
\`\`\`js
console.log('nested')
\`\`\`
~~~~

未知语言 \`\`\`weird-lang 也要原样保留。
`,
    eol: 'lf',
  },
  '08-math.md': {
    text: `# 数学公式

行内公式：$E = mc^2$，以及 \\(a^2 + b^2 = c^2\\)。

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

矩阵：

$$
\\begin{bmatrix}
1 & 0 \\\\
0 & 1
\\end{bmatrix}
$$
`,
    eol: 'lf',
  },
  '09-footnotes.md': {
    text: `# 脚注与引用

作者始终掌控文字[^1]。AI 只提出候选[^2]。

[^1]: 这是第一条脚注。
[^2]: 这是第二条脚注，包含 **强调** 与 \`code\`。

> 引用块中的脚注[^3]也要保留。
>
> [^3]: 嵌套引用里的脚注。
`,
    eol: 'lf',
  },
  '10-links-images.md': {
    text: `# 链接与图片

[普通链接](https://example.com/path?q=1&x=2)

[带标题的链接](https://example.com "标题")

![相对图片](../assets/cover.png)

![带空格路径](./images/我的 封面.png "封面")

自动链接：<https://example.com>

参考式链接：[引用][ref]

[ref]: https://example.com/reference "参考"
`,
    eol: 'lf',
  },
  '11-empty.md': {
    text: '',
    eol: 'lf',
  },
  '12-long-paragraph.md': {
    text: `# 长段落

${'这是一段用于验证长行编辑与渲染性能的文字。'.repeat(140)}

结尾。
`,
    eol: 'lf',
  },
  '13-nested-lists.md': {
    text: `# 嵌套列表

1. 第一层
   - 第二层无序
     - 第三层无序
       1. 第四层有序
       2. 继续
   - 回到第二层
2. 第一层第二项

- [ ] 未完成任务
- [x] 已完成任务

* * *

- 列表后的分隔线
`,
    eol: 'lf',
  },
  '14-mixed-eol.md': {
    text: `# 混合换行\r\n\n第二行是 LF。\r第三行只有 CR。\r\n第四行 CRLF。`,
    eol: 'raw',
  },
  '15-no-trailing-newline.md': {
    text: '# 没有结尾换行\n\n正文最后一行没有换行符。',
    eol: 'lf',
  },
  '16-combining.md': {
    text: `# 组合字符

Café 可以写成 e + ́（组合重音）：Cafe\u0301。

中文与注音：ㄨㄣˊ ㄩˇ。

越南语：Tiếng Việt。

这些字符的 UTF-16 长度与视觉长度不同，选区偏移必须以代码单元为准。
`,
    eol: 'lf',
  },
  '17-blockquote.md': {
    text: `# 引用

> 第一层引用
> > 第二层引用
> >
> > - 列表在引用中
> > - 第二项

> [!NOTE]
> GitHub 风格的提示块在首版按普通引用保留。

普通段落。
`,
    eol: 'lf',
  },
  '18-html-unknown.md': {
    text: `# HTML 与未知扩展

<div class="callout">
  <p>这是原始 HTML，编辑器不能执行脚本。</p>
</div>

::: warning
这是一个未知的容器语法，必须原样保留。
:::

<!-- 注释也要保留 -->

自定义指令：@include(./chapter-2.md)

<details>
<summary>折叠内容</summary>
内部文本。
</details>
`,
    eol: 'lf',
  },
  '19-headings.md': {
    text: `# 一级标题

## 二级标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

Setext 一级标题
==============

Setext 二级标题
--------------

# 结尾带井号 ###
`,
    eol: 'lf',
  },
  '20-mixed-syntax.md': {
    text: `---
title: 混合语法
---

# 混合语法总览

**粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)。

| A | B |
| - | - |
| 1 | 2 |

\`\`\`python
def hello(name: str) -> str:
    return f"你好，{name}"
\`\`\`

> 引用中有 **粗体** 和 $x^2$。

- [x] 任务
- [ ] 待办

[^note]: 脚注内容。

![图片](./img.png)

---

🥳 完成。
`,
    eol: 'lf',
  },
  '21-windows-paths.md': {
    text: `# Windows 路径

绝对路径：C:\\Users\\writer\\Documents\\第一章.md

带空格：D:\\My Books\\代码之上\\chapter 01.md

UNC：\\\\server\\share\\notes.md

正斜杠：C:/Users/writer/notes.md

这些路径只是文本，编辑器不得擅自解析或改写。
`,
    eol: 'crlf',
  },
  '22-unicode-tricky.md': {
    text: `# 复杂 Unicode

阿拉伯语：مرحبا بالعالم

希伯来语：שלום עולם

零宽连接符：👨‍👩‍👧‍👦 与 🇨🇳

零宽空格：a\u200Bb

软连字符：co\u00ADoperate

方向控制符：\u202Eabc\u202C

这些字符不应导致选区错位或保存损坏。
`,
    eol: 'lf',
  },
  '23-tabs-indent.md': {
    text: `# 制表符缩进

\t缩进一级
\t\t缩进二级

- 列表项
\t- 制表符缩进的子项

\`\`\`go
func main() {
\tprintln("tab")
}
\`\`\`
`,
    eol: 'lf',
  },
  '24-setext-and-rules.md': {
    text: `文档标题
========

第一部分
--------

正文。

***

另一个分隔线

___

结尾。
`,
    eol: 'lf',
  },
}

function encode(sample) {
  let body = sample.text
  if (sample.eol === 'crlf') body = body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
  if (sample.eol === 'raw') body = sample.text
  return (sample.bom ? BOM : '') + body
}

const fingerprints = {}
for (const [name, sample] of Object.entries(samples)) {
  const content = encode(sample)
  const bytes = Buffer.from(content, 'utf8')
  await writeFile(join(outDir, name), bytes)
  fingerprints[name] = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  }
}

await writeFile(
  join(outDir, 'FINGERPRINTS.json'),
  `${JSON.stringify({ version: 1, generatedAt: '2026-10-22', samples: fingerprints }, null, 2)}\n`,
  'utf8',
)

console.log(`Generated ${Object.keys(samples).length} golden samples in ${outDir}`)
