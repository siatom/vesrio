import { syntaxTree } from '@codemirror/language'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Range } from '@codemirror/state'

const HEADING = /^ATXHeading([1-6])$/

function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number
    const end = view.state.doc.lineAt(range.to).number
    for (let line = start; line <= end; line += 1) lines.add(line)
  }
  return lines
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const active = activeLines(view)
  const tree = syntaxTree(view.state)
  const from = view.viewport.from
  const to = view.viewport.to

  const hide = (fromPos: number, toPos: number, lineNumber: number) => {
    if (toPos > fromPos && !active.has(lineNumber)) {
      ranges.push(Decoration.replace({}).range(fromPos, toPos))
    }
  }
  const lineClass = (pos: number, className: string) => {
    const line = view.state.doc.lineAt(pos)
    ranges.push(Decoration.line({ class: className }).range(line.from))
  }

  tree.iterate({
    from,
    to,
    enter: (node) => {
      const name = node.name
      const heading = HEADING.exec(name)
      const lineNumber = view.state.doc.lineAt(node.from).number
      if (heading) {
        lineClass(node.from, `cm-md-heading cm-md-h${heading[1]}`)
        return
      }
      switch (name) {
        case 'HeaderMark':
          hide(node.from, node.to, lineNumber)
          return
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'CodeMark':
          hide(node.from, node.to, lineNumber)
          return
        case 'LinkMark':
        case 'URL':
          hide(node.from, node.to, lineNumber)
          return
        case 'Image':
          lineClass(node.from, 'cm-md-image-line')
          return
        case 'InlineCode':
          ranges.push(Decoration.mark({ class: 'cm-md-inline-code' }).range(node.from, node.to))
          return
        case 'Link':
          ranges.push(Decoration.mark({ class: 'cm-md-link' }).range(node.from, node.to))
          return
        case 'Blockquote':
          lineClass(node.from, 'cm-md-quote')
          return
        case 'QuoteMark':
          hide(node.from, node.to, lineNumber)
          return
        case 'ListMark':
          ranges.push(Decoration.mark({ class: 'cm-md-list-mark' }).range(node.from, node.to))
          return
        case 'FencedCode':
        case 'CodeBlock': {
          const startLine = view.state.doc.lineAt(node.from)
          const endLine = view.state.doc.lineAt(node.to)
          for (let line = startLine.number; line <= endLine.number; line += 1) {
            const info = view.state.doc.line(line)
            ranges.push(Decoration.line({ class: 'cm-md-codeblock' }).range(info.from))
          }
          return
        }
        case 'Table':
        case 'TableHeader': {
          const startLine = view.state.doc.lineAt(node.from)
          const endLine = view.state.doc.lineAt(node.to)
          for (let line = startLine.number; line <= endLine.number; line += 1) {
            const info = view.state.doc.line(line)
            ranges.push(Decoration.line({ class: 'cm-md-table' }).range(info.from))
          }
          return
        }
        case 'HorizontalRule':
          lineClass(node.from, 'cm-md-rule')
          return
        case 'HTMLBlock':
        case 'HTMLTag':
          lineClass(node.from, 'cm-md-html')
          return
        default:
          return
      }
    },
  })

  return Decoration.set(ranges, true)
}

/**
 * Typora-style live Markdown: syntax markers are hidden on quiet lines and
 * revealed on the lines the author is editing. Unknown syntax is untouched.
 */
export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)
