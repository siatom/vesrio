import { describe, expect, it } from 'vitest'
import {
  conflictHashes,
  detectedEncoding,
  friendlyMessage,
  isConflict,
  isUnsupportedEncoding,
  normalizeError,
} from '@/lib/errors'

describe('error normalization', () => {
  it('normalizes structured backend errors', () => {
    const error = normalizeError({
      code: 'external_conflict',
      message: 'changed',
      retryable: false,
      details: { diskHash: 'a', expectedHash: 'b' },
    })
    expect(error.code).toBe('external_conflict')
    expect(isConflict(error)).toBe(true)
    expect(conflictHashes(error)).toEqual({ diskHash: 'a', expectedHash: 'b' })
  })

  it('uses a friendly message for known codes', () => {
    expect(friendlyMessage({ code: 'external_conflict', message: 'x' })).toContain('未自动覆盖')
    expect(friendlyMessage({ code: 'unknown_code', message: 'raw message' })).toBe('raw message')
  })

  it('extracts detected encoding for the import dialog', () => {
    const error = { code: 'unsupported_encoding', message: 'x', details: { encoding: 'gbk' } }
    expect(isUnsupportedEncoding(error)).toBe(true)
    expect(detectedEncoding(error)).toBe('gbk')
  })

  it('handles non-object failures without crashing', () => {
    const error = normalizeError('plain failure')
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('plain failure')
  })
})
