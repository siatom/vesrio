import { describe, expect, it } from 'vitest'
import { addedText, diffText, hasChanges, removedText } from '@/lib/diff'

describe('diffText', () => {
  it('returns a single same segment for identical text', () => {
    expect(diffText('原文', '原文')).toEqual([{ type: 'same', text: '原文' }])
    expect(diffText('', '')).toEqual([])
  })

  it('marks a Chinese replacement without splitting every character', () => {
    const segments = diffText('需要对原有软件进行调整。', '需要调整软件。')
    expect(hasChanges(segments)).toBe(true)
    expect(removedText(segments)).toBe('需要对原有软件进行调整。')
    expect(addedText(segments)).toBe('需要调整软件。')
    expect(segments.some((segment) => segment.type === 'remove')).toBe(true)
    expect(segments.some((segment) => segment.type === 'add')).toBe(true)
  })

  it('reconstructs original and candidate from segments', () => {
    const original = '### 标题\n\n第一段。\n第二段带 **粗体**。'
    const candidate = '### 标题\n\n第一段。\n第二段带粗体。'
    const segments = diffText(original, candidate)
    expect(removedText(segments)).toBe(original)
    expect(addedText(segments)).toBe(candidate)
  })

  it('keeps newlines visible in the diff', () => {
    const segments = diffText('a\nb', 'a\nb\nc')
    expect(segments.some((segment) => segment.type === 'add' && segment.text.includes('c'))).toBe(true)
    expect(segments.some((segment) => segment.text.includes('\n'))).toBe(true)
  })

  it('handles emoji without corrupting surrogate pairs', () => {
    const segments = diffText('你好👩‍👩‍👧‍👦世界', '你好🌏世界')
    expect(removedText(segments)).toBe('你好👩‍👩‍👧‍👦世界')
    expect(addedText(segments)).toBe('你好🌏世界')
  })

  it('treats Latin words as tokens', () => {
    const segments = diffText('the quick brown fox', 'the quick red fox')
    expect(segments).toContainEqual({ type: 'remove', text: 'brown' })
    expect(segments).toContainEqual({ type: 'add', text: 'red' })
  })
})
