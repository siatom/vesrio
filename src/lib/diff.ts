import { diffArrays } from 'diff'
import type { DiffSegment } from './types'

/**
 * Tokenize into CJK characters, Latin words, whitespace runs and single
 * punctuation marks. This keeps Chinese diffs readable instead of one giant
 * replaced line.
 */
export function tokenize(text: string): string[] {
  const matches = text.match(
    /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*|\s+|[\s\S]/gu,
  )
  return matches ?? []
}

export function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = []
  for (const segment of segments) {
    if (!segment.text) continue
    const last = merged[merged.length - 1]
    if (last && last.type === segment.type) {
      last.text += segment.text
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

export function diffText(original: string, candidate: string): DiffSegment[] {
  if (original === candidate) {
    return original ? [{ type: 'same', text: original }] : []
  }
  const parts = diffArrays(tokenize(original), tokenize(candidate))
  const segments: DiffSegment[] = []
  for (const part of parts) {
    const text = part.value.join('')
    const type: DiffSegment['type'] = part.added ? 'add' : part.removed ? 'remove' : 'same'
    segments.push({ type, text })
  }
  return mergeSegments(segments)
}

export function hasChanges(segments: DiffSegment[]): boolean {
  return segments.some((segment) => segment.type !== 'same')
}

export function removedText(segments: DiffSegment[]): string {
  return segments
    .filter((segment) => segment.type !== 'add')
    .map((segment) => segment.text)
    .join('')
}

export function addedText(segments: DiffSegment[]): string {
  return segments
    .filter((segment) => segment.type !== 'remove')
    .map((segment) => segment.text)
    .join('')
}
