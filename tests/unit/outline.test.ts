import { describe, expect, it } from 'vitest'
import { activeHeadingIndex, parseOutline } from '@/lib/outline'

describe('parseOutline', () => {
  it('extracts nested ATX headings with offsets', () => {
    const text = '# 第一章\n\n正文\n\n## 1.1 小节\n### 更深\n'
    const outline = parseOutline(text)
    expect(outline.map((item) => [item.level, item.text])).toEqual([
      [1, '第一章'],
      [2, '1.1 小节'],
      [3, '更深'],
    ])
    expect(text.slice(outline[1]?.from)).toMatch(/^## 1\.1/)
  })

  it('strips inline markdown from heading text', () => {
    const outline = parseOutline('## **粗体**与[链接](https://example.com) `code`\n')
    expect(outline[0]?.text).toBe('粗体与链接 code')
  })

  it('ignores heading-like lines inside fenced code', () => {
    const text = '# 真标题\n\n```bash\n# not a heading\necho hi\n```\n\n## 后面的标题\n'
    const outline = parseOutline(text)
    expect(outline.map((item) => item.text)).toEqual(['真标题', '后面的标题'])
  })

  it('supports Setext headings', () => {
    const outline = parseOutline('标题一\n=====\n\n标题二\n-----\n')
    expect(outline.map((item) => [item.level, item.text])).toEqual([
      [1, '标题一'],
      [2, '标题二'],
    ])
  })

  it('returns an empty outline for a document without headings', () => {
    expect(parseOutline('普通段落。\n第二行。')).toEqual([])
  })

  it('tracks the active heading for a cursor line', () => {
    const outline = parseOutline('# A\ntext\n## B\ntext\n### C\n')
    expect(activeHeadingIndex(outline, 1)).toBe(0)
    expect(activeHeadingIndex(outline, 3)).toBe(1)
    expect(activeHeadingIndex(outline, 5)).toBe(2)
    expect(activeHeadingIndex(outline, 0)).toBe(-1)
  })
})
