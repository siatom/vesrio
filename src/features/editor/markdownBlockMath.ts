import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { scanBlockMath } from './math'
import { MathWidget } from './markdownWidgets'

export interface BlockMath {
  from: number
  to: number
  tex: string
}

interface BlockMathState {
  blocks: BlockMath[]
  decorations: DecorationSet
  hasMarkers: boolean
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number
    const end = state.doc.lineAt(range.to).number
    for (let line = start; line <= end; line += 1) lines.add(line)
  }
  return lines
}

function build(state: EditorState, blocks: BlockMath[], hasMarkers: boolean): BlockMathState {
  const active = activeLines(state)
  const ranges = []
  for (const block of blocks) {
    const startLine = state.doc.lineAt(block.from).number
    const endLine = state.doc.lineAt(block.to).number
    let visible = true
    for (let line = startLine; line <= endLine; line += 1) {
      if (active.has(line)) {
        visible = false
        break
      }
    }
    if (!visible) continue
    ranges.push(
      Decoration.replace({
        widget: new MathWidget(block.tex, true),
        block: true,
      }).range(block.from, block.to),
    )
  }
  return { blocks, decorations: Decoration.set(ranges, true), hasMarkers }
}

function hasMathMarkers(text: string): boolean {
  return text.includes('$') || text.includes('\\[')
}

/**
 * Display math needs block decorations, which CodeMirror only accepts from a
 * state field (not from a view plugin). Inline math, images, and links stay in
 * the view plugin so they can follow the visible viewport.
 */
export const blockMathField = StateField.define<BlockMathState>({
  create(state) {
    const text = state.doc.toString()
    const markers = hasMathMarkers(text)
    return build(state, markers ? scanBlockMath(text) : [], markers)
  },
  update(value, transaction) {
    const docChanged = transaction.docChanged
    const selectionChanged = transaction.selection !== undefined
    if (!docChanged && !selectionChanged) return value

    if (docChanged) {
      let needsScan = value.hasMarkers
      if (!needsScan) {
        // Without any math marker in the old document, only inserted markers
        // can create a formula. This keeps ordinary typing off the line scan.
        transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          if (needsScan) return
          const inserted = transaction.newDoc.sliceString(fromB, toB)
          if (inserted.includes('$') || inserted.includes('\\')) {
            needsScan = true
          } else if (
            inserted.includes('[') &&
            fromB > 0 &&
            transaction.newDoc.sliceString(fromB - 1, fromB) === '\\'
          ) {
            needsScan = true
          }
        })
      }
      if (!needsScan) return build(transaction.state, [], false)
      const text = transaction.state.doc.toString()
      const markers = hasMathMarkers(text)
      return build(transaction.state, markers ? scanBlockMath(text) : [], markers)
    }

    return build(transaction.state, value.blocks, value.hasMarkers)
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const blockMathExtension: Extension = blockMathField
