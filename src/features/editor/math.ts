/**
 * Lightweight display-math scanner used by the live preview.
 *
 * The Markdown parser does not produce math nodes, so formulas are detected on
 * the visible lines. Anything the scanner reports is still filtered against
 * code ranges by the caller; this module stays pure so it can be unit tested.
 */

export interface MathMatch {
  /** 0-based line index where the formula starts. */
  startLine: number
  /** 0-based line index where the formula ends. */
  endLine: number
  /** 0-based column of the opening marker. */
  startColumn: number
  /** 0-based column just after the closing marker. */
  endColumn: number
  tex: string
  block: boolean
}

const INLINE_PAREN = /(?<!\\)\\\((.+?)\\\)/g
const INLINE_DOLLAR = /(?<!\\)((?<!\$)\$(?!\$))([^\n$]+?)(\$(?!\$))/g

function trimMath(value: string): string {
  return value.replace(/^\s+|\s+$/g, '')
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashes += 1
  }
  return slashes % 2 === 1
}

function inlineMatches(line: string): MathMatch[] {
  const matches: MathMatch[] = []

  for (const match of line.matchAll(INLINE_PAREN)) {
    const start = match.index ?? 0
    if (isEscaped(line, start)) continue
    const tex = trimMath(match[1] ?? '')
    if (!tex) continue
    matches.push({
      startLine: 0,
      endLine: 0,
      startColumn: start,
      endColumn: start + match[0].length,
      tex,
      block: false,
    })
  }

  for (const match of line.matchAll(INLINE_DOLLAR)) {
    const start = match.index ?? 0
    if (isEscaped(line, start)) continue
    const inner = match[2] ?? ''
    // Follow the common Markdown math convention: no padding inside `$...$`.
    if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) continue
    matches.push({
      startLine: 0,
      endLine: 0,
      startColumn: start,
      endColumn: start + match[0].length,
      tex: inner,
      block: false,
    })
  }

  return matches.sort((left, right) => left.startColumn - right.startColumn)
}

/** Scan a single line for inline `$...$` and `\(...\)` formulas. */
export function scanInlineMath(line: string): MathMatch[] {
  return inlineMatches(line)
}

interface DisplayMarker {
  open: string
  close: string
}

const DISPLAY_MARKERS: DisplayMarker[] = [
  { open: '$$', close: '$$' },
  { open: '\\[', close: '\\]' },
]

/**
 * Scan lines for `$...$`, `\(...\)`, `$$...$$` and `\[...\]` formulas.
 * Line indices are relative to the supplied array.
 */
export function scanMathLines(lines: readonly string[]): MathMatch[] {
  const matches: MathMatch[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const leading = line.search(/\S/)
    if (leading < 0) continue

    const marker = DISPLAY_MARKERS.find((candidate) => line.startsWith(candidate.open, leading))
    if (marker) {
      const openAt = leading
      const contentStart = openAt + marker.open.length
      const sameLineClose = line.indexOf(marker.close, contentStart)
      if (sameLineClose >= 0) {
        const tex = trimMath(line.slice(contentStart, sameLineClose))
        if (tex) {
          matches.push({
            startLine: index,
            endLine: index,
            startColumn: openAt,
            endColumn: sameLineClose + marker.close.length,
            tex,
            block: true,
          })
        }
        continue
      }

      let closeLine = index + 1
      for (; closeLine < lines.length; closeLine += 1) {
        if ((lines[closeLine] ?? '').includes(marker.close)) break
      }
      if (closeLine >= lines.length) continue

      const closing = lines[closeLine] ?? ''
      const closeAt = closing.indexOf(marker.close)
      const tex = trimMath(
        [line.slice(contentStart), ...lines.slice(index + 1, closeLine), closing.slice(0, closeAt)].join(
          '\n',
        ),
      )
      if (tex) {
        matches.push({
          startLine: index,
          endLine: closeLine,
          startColumn: openAt,
          endColumn: closeAt + marker.close.length,
          tex,
          block: true,
        })
      }
      index = closeLine
      continue
    }

    matches.push(...inlineMatches(line).map((match) => ({ ...match, startLine: index, endLine: index })))
  }

  return matches
}

export interface BlockMathMatch {
  /** Offset of the first display-math line. */
  from: number
  /** Offset of the end of the last display-math line (without its newline). */
  to: number
  tex: string
}

const FENCE_LINE = /^\s{0,3}(```|~~~)/

/**
 * Collect display-math blocks from a whole document. Fenced code is skipped so
 * a `$$` example inside a code fence is not turned into a formula. Returned
 * ranges always cover complete lines, as required for block decorations.
 */
export function scanBlockMath(text: string): BlockMathMatch[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  const matches: BlockMathMatch[] = []
  let inFence = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (FENCE_LINE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const leading = line.search(/\S/)
    if (leading < 0 || leading > 3) continue
    const marker = DISPLAY_MARKERS.find((candidate) => line.startsWith(candidate.open, leading))
    if (!marker) continue

    const contentStart = leading + marker.open.length
    const sameLineClose = line.indexOf(marker.close, contentStart)
    if (sameLineClose >= 0) {
      const tex = trimMath(line.slice(contentStart, sameLineClose))
      if (tex) {
        matches.push({
          from: starts[index] ?? 0,
          to: (starts[index] ?? 0) + line.length,
          tex,
        })
      }
      continue
    }

    let closeLine = index + 1
    for (; closeLine < lines.length; closeLine += 1) {
      if ((lines[closeLine] ?? '').includes(marker.close)) break
    }
    if (closeLine >= lines.length) continue

    const closing = lines[closeLine] ?? ''
    const closeAt = closing.indexOf(marker.close)
    const tex = trimMath(
      [
        line.slice(contentStart),
        ...lines.slice(index + 1, closeLine),
        closing.slice(0, closeAt),
      ].join('\n'),
    )
    if (tex) {
      matches.push({
        from: starts[index] ?? 0,
        to: (starts[closeLine] ?? 0) + closing.length,
        tex,
      })
    }
    index = closeLine
  }

  return matches
}
