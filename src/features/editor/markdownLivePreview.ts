import { syntaxTree } from '@codemirror/language'
import { Facet, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/api'
import {
  collectLinkDefinitions,
  parseAutolink,
  parseInlineLink,
  referenceDestination,
  resolveMarkdownTarget,
  type InlineLinkParts,
} from '@/lib/markdownTargets'
import { findHeadingOffset } from '@/lib/outline'
import { useUiStore } from '@/stores/ui'
import { scanInlineMath } from './math'
import { blockMathField } from './markdownBlockMath'
import { ImageWidget, MathWidget, type ImageWidgetSpec } from './markdownWidgets'
import { openMarkdownLink } from './openLink'

const HEADING = /^ATXHeading([1-6])$/
const PROTECTED = new Set([
  'FencedCode',
  'CodeBlock',
  'InlineCode',
  'HTMLBlock',
  'HTMLTag',
  'Autolink',
])

const linkDefinitionCache = new WeakMap<object, Map<string, string>>()

function linkDefinitions(doc: object & { toString(): string }): Map<string, string> {
  let cached = linkDefinitionCache.get(doc)
  if (!cached) {
    cached = collectLinkDefinitions(doc.toString())
    linkDefinitionCache.set(doc, cached)
  }
  return cached
}

/** Current document path, used to resolve relative image and link targets. */
export const documentPathFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
})

interface PositionedRange {
  from: number
  to: number
}

function activeLines(view: EditorView): Set<number> {
  const lines = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number
    const end = view.state.doc.lineAt(range.to).number
    for (let line = start; line <= end; line += 1) lines.add(line)
  }
  return lines
}

function intersects(ranges: readonly PositionedRange[], from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

function imageLabel(raw: string): string {
  const match = /^!\[([^\]]*)\]/.exec(raw)
  return match?.[1] ?? ''
}

function parseImage(raw: string, definitions: () => Map<string, string>): InlineLinkParts | null {
  const inline = parseInlineLink(raw)
  if (inline?.image) return inline
  const destination = referenceDestination(raw, definitions())
  if (!destination) return null
  return { label: imageLabel(raw), destination, title: '', image: true }
}

function linkDestination(raw: string, definitions: () => Map<string, string>): string | null {
  const inline = parseInlineLink(raw)
  if (inline && !inline.image) return inline.destination
  const autolink = parseAutolink(raw)
  if (autolink) return autolink
  return referenceDestination(raw, definitions())
}

function imageSpec(
  destination: string,
  alt: string,
  title: string,
  documentPath: string,
): ImageWidgetSpec | null {
  const target = resolveMarkdownTarget(destination, documentPath)
  const base = { source: destination, alt, title }
  switch (target.kind) {
    case 'data':
      return { ...base, kind: 'data', url: target.url }
    case 'external':
      return { ...base, kind: 'remote', url: target.url }
    case 'file':
      if (!isTauri() || !target.path) return { ...base, kind: 'invalid', url: '' }
      return { ...base, kind: 'local', url: convertFileSrc(target.path) }
    default:
      return { ...base, kind: 'invalid', url: '' }
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const replacements: PositionedRange[] = []
  const protectedRanges: PositionedRange[] = []
  const active = activeLines(view)
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  const documentPath = view.state.facet(documentPathFacet)
  const blockRanges = view.state.field(blockMathField, false)?.blocks ?? []
  const inBlockMath = (fromPos: number, toPos: number) => intersects(blockRanges, fromPos, toPos)
  let definitions: Map<string, string> | null = null
  const getDefinitions = () => {
    definitions ??= linkDefinitions(doc)
    return definitions
  }

  const hide = (fromPos: number, toPos: number, lineNumber: number) => {
    if (toPos <= fromPos || active.has(lineNumber)) return
    if (inBlockMath(fromPos, toPos)) return
    if (intersects(replacements, fromPos, toPos)) return
    ranges.push(Decoration.replace({}).range(fromPos, toPos))
  }
  const lineClass = (pos: number, className: string) => {
    const line = doc.lineAt(pos)
    ranges.push(Decoration.line({ class: className }).range(line.from))
  }

  // Code and raw HTML must never be interpreted as math or images.
  tree.iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter: (node) => {
      if (PROTECTED.has(node.name)) {
        protectedRanges.push({ from: node.from, to: node.to })
        return false
      }
      return undefined
    },
  })

  // Inline math is not part of the Markdown syntax tree. Display math lives in
  // blockMathField because CodeMirror only allows block widgets there.
  const firstLine = doc.lineAt(view.viewport.from)
  const lastVisible = doc.lineAt(view.viewport.to)

  for (let number = firstLine.number; number <= lastVisible.number; number += 1) {
    const info = doc.line(number)
    for (const match of scanInlineMath(info.text)) {
      const fromPos = info.from + match.startColumn
      const toPos = info.from + match.endColumn
      if (toPos <= fromPos) continue
      if (active.has(info.number)) continue
      if (intersects(protectedRanges, fromPos, toPos)) continue
      if (intersects(blockRanges, fromPos, toPos)) continue
      if (intersects(replacements, fromPos, toPos)) continue
      replacements.push({ from: fromPos, to: toPos })
      ranges.push(
        Decoration.replace({
          widget: new MathWidget(match.tex, false),
        }).range(fromPos, toPos),
      )
    }
  }

  tree.iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter: (node) => {
      const name = node.name
      const heading = HEADING.exec(name)
      const line = doc.lineAt(node.from)
      const lineNumber = line.number

      if (heading) {
        lineClass(node.from, `cm-md-heading cm-md-h${heading[1]}`)
        return
      }

      switch (name) {
        case 'HeaderMark':
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'CodeMark':
        case 'LinkMark':
        case 'URL':
          hide(node.from, node.to, lineNumber)
          return
        case 'Image': {
          const raw = doc.sliceString(node.from, node.to)
          const parsed = parseImage(raw, getDefinitions)
          if (
            parsed &&
            !active.has(lineNumber) &&
            !inBlockMath(node.from, node.to) &&
            !intersects(replacements, node.from, node.to)
          ) {
            const spec = imageSpec(parsed.destination, parsed.label, parsed.title, documentPath)
            if (spec) {
              replacements.push({ from: node.from, to: node.to })
              ranges.push(Decoration.replace({ widget: new ImageWidget(spec) }).range(node.from, node.to))
              lineClass(node.from, 'cm-md-image-line')
            }
          }
          return false
        }
        case 'InlineCode':
          if (!inBlockMath(node.from, node.to)) {
            ranges.push(Decoration.mark({ class: 'cm-md-inline-code' }).range(node.from, node.to))
          }
          return
        case 'Autolink': {
          if (inBlockMath(node.from, node.to)) return
          const href = parseAutolink(doc.sliceString(node.from, node.to))
          ranges.push(
            Decoration.mark({
              class: 'cm-md-link',
              attributes: href ? { 'data-md-href': href, title: `打开链接：${href}` } : undefined,
            }).range(node.from, node.to),
          )
          return
        }
        case 'Link': {
          if (inBlockMath(node.from, node.to)) return
          const href = linkDestination(doc.sliceString(node.from, node.to), getDefinitions)
          ranges.push(
            Decoration.mark({
              class: 'cm-md-link',
              attributes: href ? { 'data-md-href': href, title: `打开链接：${href}` } : undefined,
            }).range(node.from, node.to),
          )
          return
        }
        case 'Blockquote':
          lineClass(node.from, 'cm-md-quote')
          return
        case 'QuoteMark':
          hide(node.from, node.to, lineNumber)
          return
        case 'ListMark':
          if (!inBlockMath(node.from, node.to)) {
            ranges.push(Decoration.mark({ class: 'cm-md-list-mark' }).range(node.from, node.to))
          }
          return
        case 'FencedCode':
        case 'CodeBlock': {
          const startLine = doc.lineAt(node.from)
          const endLine = doc.lineAt(node.to)
          for (let number = startLine.number; number <= endLine.number; number += 1) {
            ranges.push(Decoration.line({ class: 'cm-md-codeblock' }).range(doc.line(number).from))
          }
          return false
        }
        case 'Table':
        case 'TableHeader': {
          const startLine = doc.lineAt(node.from)
          const endLine = doc.lineAt(node.to)
          for (let number = startLine.number; number <= endLine.number; number += 1) {
            ranges.push(Decoration.line({ class: 'cm-md-table' }).range(doc.line(number).from))
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

function scrollToAnchor(view: EditorView, anchor: string): boolean {
  const offset = findHeadingOffset(view.state.doc.toString(), anchor)
  if (offset == null) return false
  view.dispatch({ selection: { anchor: offset }, scrollIntoView: true })
  view.focus()
  return true
}

function handleMouseDown(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0) return false
  const target = event.target instanceof Element ? event.target : null
  const anchor = target?.closest('[data-md-href]')
  const href = anchor?.getAttribute('data-md-href')
  if (!anchor || !href) return false

  const position = view.posAtDOM(anchor)
  const lineNumber = view.state.doc.lineAt(position).number
  const modified = event.ctrlKey || event.metaKey
  if (!modified && activeLines(view).has(lineNumber)) return false

  event.preventDefault()
  const documentPath = view.state.facet(documentPathFacet)
  const resolved = resolveMarkdownTarget(href, documentPath)
  if (resolved.kind === 'anchor') {
    if (!scrollToAnchor(view, resolved.anchor)) {
      useUiStore().warn('没有找到对应的标题', href)
    }
    return true
  }
  void openMarkdownLink(href, documentPath)
  return true
}

/**
 * Typora-style live Markdown: syntax markers are hidden on quiet lines and
 * revealed on the lines the author is editing. Images and math are drawn as
 * widgets; links stay clickable. Unknown syntax is untouched.
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
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: { mousedown: handleMouseDown },
  },
)
