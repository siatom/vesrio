import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { revealSource } from './markdownWidgets'
import { scanMermaidBlocks, type MermaidMatch } from './mermaid'

export type DiagramTheme = 'light' | 'dark'

interface MermaidState {
  blocks: MermaidMatch[]
  decorations: DecorationSet
  theme: DiagramTheme
  hasMarker: boolean
}

type MermaidApi = typeof import('mermaid')['default']

const CACHE_LIMIT = 24
const cache = new Map<string, string>()
let mermaidPromise: Promise<MermaidApi> | null = null
let initializedKey = ''
let renderId = 0

export const diagramThemeEffect = StateEffect.define<DiagramTheme>()

export function refreshDiagramTheme(view: EditorView, theme: DiagramTheme): void {
  view.dispatch({ effects: diagramThemeEffect.of(theme) })
}

function currentTheme(): DiagramTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

function themeVariables(theme: DiagramTheme): Record<string, string | boolean> {
  const styles =
    typeof document === 'undefined'
      ? null
      : getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    styles ? cssVar(styles, name, fallback) : fallback
  const text = read('--text', theme === 'dark' ? '#ece7de' : '#1f2429')
  const surface = read('--surface', theme === 'dark' ? '#1b1f24' : '#fbf9f4')
  const raised = read('--surface-raised', theme === 'dark' ? '#232830' : '#ffffff')

  return {
    darkMode: theme === 'dark',
    background: surface,
    fontFamily: read('--font-ui', 'system-ui, sans-serif'),
    fontSize: '14px',
    textColor: text,
    primaryColor: raised,
    primaryTextColor: text,
    primaryBorderColor: read('--border-strong', '#cfc7b8'),
    secondaryColor: read('--panel', '#f2eee5'),
    secondaryTextColor: text,
    secondaryBorderColor: read('--border', '#e3ddd1'),
    tertiaryColor: read('--bg-soft', '#efeae0'),
    tertiaryTextColor: text,
    tertiaryBorderColor: read('--border', '#e3ddd1'),
    mainBkg: raised,
    nodeBorder: read('--border-strong', '#cfc7b8'),
    clusterBkg: read('--bg-soft', '#efeae0'),
    clusterBorder: read('--border', '#e3ddd1'),
    lineColor: read('--text-muted', '#676c6f'),
    edgeLabelBackground: surface,
    titleColor: text,
    noteBkgColor: read('--panel', '#f2eee5'),
    noteTextColor: text,
    noteBorderColor: read('--border', '#e3ddd1'),
    actorBkg: raised,
    actorBorder: read('--border-strong', '#cfc7b8'),
    actorTextColor: text,
    signalColor: read('--text-muted', '#676c6f'),
    signalTextColor: text,
  }
}

async function mermaidApi(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((module) => module.default)
  return mermaidPromise
}

async function configure(variables: Record<string, string | boolean>) {
  const mermaid = await mermaidApi()
  const key = JSON.stringify(variables)
  if (key !== initializedKey) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: variables,
      fontFamily: String(variables.fontFamily ?? 'system-ui, sans-serif'),
      layout: 'dagre',
      flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
      sequence: { useMaxWidth: true },
    })
    initializedKey = key
  }
  return mermaid
}

function remember(key: string, svg: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, svg)
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly theme: DiagramTheme,
  ) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.theme === this.theme
  }

  get estimatedHeight(): number {
    return 240
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-md-mermaid'
    wrapper.setAttribute('role', 'img')
    wrapper.setAttribute('aria-label', 'Mermaid 图表')
    wrapper.title = 'Mermaid 图表 · 点击编辑源码'
    wrapper.addEventListener('mousedown', (event) => revealSource(wrapper, view, event))
    void this.render(wrapper, view)
    return wrapper
  }

  private async render(wrapper: HTMLElement, view: EditorView): Promise<void> {
    const variables = themeVariables(this.theme)
    const key = `${this.theme}\u0000${JSON.stringify(variables)}\u0000${this.code}`
    const cached = cache.get(key)
    if (cached) {
      wrapper.innerHTML = cached
      return
    }

    const loading = document.createElement('div')
    loading.className = 'cm-md-mermaid__loading'
    loading.textContent = '正在渲染流程图…'
    wrapper.appendChild(loading)

    try {
      const mermaid = await configure(variables)
      const result = await mermaid.render(`vesrio-mermaid-${++renderId}`, this.code)
      if (!wrapper.isConnected) return
      remember(key, result.svg)
      wrapper.innerHTML = result.svg
      view.requestMeasure()
    } catch (error) {
      if (!wrapper.isConnected) return
      wrapper.classList.add('cm-md-mermaid--error')
      const title = document.createElement('strong')
      title.className = 'cm-md-mermaid__error-title'
      title.textContent = '流程图渲染失败'
      const detail = document.createElement('code')
      detail.className = 'cm-md-mermaid__error-detail'
      detail.textContent =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'
      const hint = document.createElement('span')
      hint.className = 'cm-md-mermaid__error-hint'
      hint.textContent = '点击查看源码'
      wrapper.replaceChildren(title, detail, hint)
      view.requestMeasure()
    }
  }
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

function build(
  state: EditorState,
  blocks: MermaidMatch[],
  theme: DiagramTheme,
  hasMarker: boolean,
): MermaidState {
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
        widget: new MermaidWidget(block.code, theme),
        block: true,
      }).range(block.from, block.to),
    )
  }
  return { blocks, decorations: Decoration.set(ranges, true), theme, hasMarker }
}

function hasMermaid(text: string): boolean {
  return text.toLowerCase().includes('mermaid')
}

/**
 * Mermaid diagrams need block decorations, so they live in a state field.
 * The Mermaid bundle is imported lazily the first time a diagram is painted.
 */
export const mermaidField = StateField.define<MermaidState>({
  create(state) {
    const text = state.doc.toString()
    const marker = hasMermaid(text)
    return build(state, marker ? scanMermaidBlocks(text) : [], currentTheme(), marker)
  },
  update(value, transaction) {
    let theme = value.theme
    let themeChanged = false
    for (const effect of transaction.effects) {
      if (effect.is(diagramThemeEffect)) {
        theme = effect.value
        themeChanged = true
      }
    }

    const docChanged = transaction.docChanged
    const selectionChanged = transaction.selection !== undefined
    if (!docChanged && !selectionChanged && !themeChanged) return value

    if (docChanged) {
      let needsScan = value.hasMarker
      if (!needsScan) {
        transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          if (needsScan) return
          if (transaction.newDoc.sliceString(fromB, toB).toLowerCase().includes('mermaid')) {
            needsScan = true
          }
        })
      }
      if (!needsScan) return build(transaction.state, [], theme, false)
      const text = transaction.state.doc.toString()
      const marker = hasMermaid(text)
      return build(transaction.state, marker ? scanMermaidBlocks(text) : [], theme, marker)
    }

    return build(transaction.state, value.blocks, theme, value.hasMarker)
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

export const mermaidExtension: Extension = mermaidField
