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

/**
 * GitHub-style heading slug used by `#anchor` links in Markdown documents.
 * Kept intentionally small: lowercase, strip formatting and punctuation, then
 * collapse whitespace to hyphens.
 */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/** Find the document offset for a `#heading` link, or null when it is absent. */
export function findHeadingOffset(text: string, anchor: string): number | null {
  let wanted = anchor.replace(/^#/, '').trim().toLowerCase()
  try {
    wanted = decodeURIComponent(wanted)
  } catch {
    // Keep the raw anchor when it is not valid percent-encoding.
  }
  if (!wanted) return null

  const headings = parseOutline(text)
  const exact = headings.find((heading) => heading.text.trim().toLowerCase() === wanted)
  if (exact) return exact.from
  const slugged = headings.find((heading) => headingSlug(heading.text) === wanted)
  return slugged ? slugged.from : null
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
