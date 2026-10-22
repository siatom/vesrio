/**
 * Locate Mermaid fenced code blocks without touching the Markdown source.
 *
 * Only complete fences are returned. The scanner is line-based so it can run
 * from a state field without asking the editor for its viewport.
 */

export interface MermaidMatch {
  /** Offset of the opening fence line. */
  from: number
  /** Offset of the end of the closing fence line (without its newline). */
  to: number
  code: string
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/

export function scanMermaidBlocks(text: string): MermaidMatch[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  const matches: MermaidMatch[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const open = FENCE.exec(line)
    if (!open) {
      index += 1
      continue
    }

    const fence = open[2] ?? ''
    const info = (open[3] ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const marker = fence[0] ?? '`'
    const close = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${fence.length},}\\s*$`)

    let closeLine = index + 1
    for (; closeLine < lines.length; closeLine += 1) {
      if (close.test(lines[closeLine] ?? '')) break
    }
    if (closeLine >= lines.length) break

    if (info === 'mermaid') {
      const code = lines.slice(index + 1, closeLine).join('\n').replace(/^\n+|\n+$/g, '')
      if (code.trim()) {
        matches.push({
          from: starts[index] ?? 0,
          to: (starts[closeLine] ?? 0) + (lines[closeLine] ?? '').length,
          code,
        })
      }
    }

    index = closeLine + 1
  }

  return matches
}
