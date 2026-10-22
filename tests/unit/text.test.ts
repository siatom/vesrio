import { describe, expect, it } from 'vitest'
import {
  basename,
  countCharacters,
  countWords,
  formatBytes,
  formatDateTime,
  isMarkdownPath,
  relativeTime,
  truncateMiddle,
  utf16Length,
} from '@/lib/text'

describe('text utilities', () => {
  it('counts CJK characters and Latin words', () => {
    expect(countWords('你好 world，hello 世界')).toBe(6)
    expect(countWords('')).toBe(0)
  })

  it('counts Unicode code points rather than UTF-16 units', () => {
    expect(countCharacters('👩‍👩‍👧‍👦')).toBe(7)
    expect(utf16Length('👩‍👩‍👧‍👦')).toBe(11)
    expect(utf16Length('中文')).toBe(2)
  })

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
  })

  it('handles Windows paths', () => {
    expect(basename('C:\\写作\\第一章.md')).toBe('第一章.md')
    expect(basename('/home/user/a.md')).toBe('a.md')
    expect(isMarkdownPath('A.MD')).toBe(true)
    expect(isMarkdownPath('a.png')).toBe(false)
  })

  it('truncates long paths in the middle', () => {
    const result = truncateMiddle('abcdefghijklmnopqrstuvwxyz', 9)
    expect(result).toContain('…')
    expect(result.length).toBeLessThanOrEqual(9)
  })

  it('formats relative times', () => {
    const now = Date.parse('2026-10-22T12:00:00Z')
    expect(relativeTime('2026-10-22T11:59:30Z', now)).toBe('刚刚')
    expect(relativeTime('2026-10-22T11:30:00Z', now)).toBe('30 分钟前')
    expect(relativeTime('not-a-date', now)).toBe('not-a-date')
    expect(formatDateTime('not-a-date')).toBe('not-a-date')
  })
})
