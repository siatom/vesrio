import { describe, expect, it } from 'vitest'
import { scanBlockMath, scanMathLines } from '@/features/editor/math'

describe('scanMathLines', () => {
  it('finds inline dollar and parenthesis formulas with exact columns', () => {
    const line = '行内 $E=mc^2$ 与 \\(a^2+b^2=c^2\\)。'
    const matches = scanMathLines([line])
    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({
      startLine: 0,
      endLine: 0,
      tex: 'E=mc^2',
      block: false,
    })
    expect(line.slice(matches[0]?.startColumn, matches[0]?.endColumn)).toBe('$E=mc^2$')
    expect(matches[1]?.tex).toBe('a^2+b^2=c^2')
  })

  it('finds multi-line display formulas', () => {
    const matches = scanMathLines(['前言', '$$', 'a^2 + b^2 = c^2', '$$', '后文'])
    expect(matches).toEqual([
      {
        startLine: 1,
        endLine: 3,
        startColumn: 0,
        endColumn: 2,
        tex: 'a^2 + b^2 = c^2',
        block: true,
      },
    ])
  })

  it('finds single-line display formulas and bracket display formulas', () => {
    const matches = scanMathLines(['$$ E=mc^2 $$', '\\[ x^2 \\]'])
    expect(matches.map((match) => [match.block, match.tex])).toEqual([
      [true, 'E=mc^2'],
      [true, 'x^2'],
    ])
  })

  it('ignores escaped dollars and prices with padding spaces', () => {
    expect(scanMathLines(['价格 \\$5 与 $6 元'])).toEqual([])
    expect(scanMathLines(['价格 $5 和 $10'])).toEqual([])
  })

  it('ignores an unclosed display formula', () => {
    expect(scanMathLines(['$$', 'a^2'])).toEqual([])
  })

  it('reports line numbers relative to the supplied window', () => {
    const matches = scanMathLines(['alpha', '$x$'])
    expect(matches[0]).toMatchObject({ startLine: 1, endLine: 1, tex: 'x' })
  })
})

describe('scanBlockMath', () => {
  it('returns full-line offsets for display formulas', () => {
    const text = '前言\n\n$$\na^2 + b^2 = c^2\n$$\n\n后文'
    const matches = scanBlockMath(text)
    expect(matches).toHaveLength(1)
    expect(text.slice(matches[0]?.from, matches[0]?.to)).toBe('$$\na^2 + b^2 = c^2\n$$')
    expect(matches[0]?.tex).toBe('a^2 + b^2 = c^2')
  })

  it('does not treat formulas inside fenced code as display math', () => {
    const text = '```md\n$$\nx^2\n$$\n```\n\n$$y^2$$'
    const matches = scanBlockMath(text)
    expect(matches.map((match) => match.tex)).toEqual(['y^2'])
  })

  it('ignores indented display markers and unclosed blocks', () => {
    expect(scanBlockMath('    $$\n    x^2\n    $$')).toEqual([])
    expect(scanBlockMath('$$\nno close')).toEqual([])
  })
})
