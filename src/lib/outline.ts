import type { OutlineHeading } from './types'

const FENCE = /^\s*(```|~~~)/

/** Extract ATX and Setext headings while ignoring fenced code blocks. */
export function parseOutline(text: string): OutlineHeading[] {
  const lines = text.split('\n')
  const headings: OutlineHeading[] = []
  let offset = 0
  let inFence = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FENCE.test(line)) {
      inFence = !inFence
      offset += line.length + 1
      continue
    }
    if (!inFence) {
      const atx = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line)
      if (atx) {
        const textContent = stripInline(atx[2] ?? '')
        if (textContent) {
          headings.push({
            level: (atx[1] ?? '#').length,
            text: textContent,
            from: offset,
            line: index + 1,
          })
        }
      } else if (index + 1 < lines.length) {
        const next = lines[index + 1] ?? ''
        if (line.trim() && /^\s*(=+|-+)\s*$/.test(next) && !FENCE.test(line)) {
          headings.push({
            level: next.trim().startsWith('=') ? 1 : 2,
            text: stripInline(line.trim()),
            from: offset,
            line: index + 1,
          })
        }
      }
    }
    offset += line.length + 1
  }
  return headings
}

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
}

export function activeHeadingIndex(headings: OutlineHeading[], cursorLine: number): number {
  let active = -1
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    if (heading && heading.line <= cursorLine) active = index
    else break
  }
  return active
}
