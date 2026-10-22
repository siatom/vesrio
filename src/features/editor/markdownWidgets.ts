import katex from 'katex'
import { WidgetType, type EditorView } from '@codemirror/view'

/**
 * Rendered widgets are only presentation. The Markdown source remains the
 * single source of truth and is revealed again as soon as its line is active.
 */

function revealSource(widget: HTMLElement, view: EditorView, event: Event): void {
  if (event instanceof MouseEvent && event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const position = view.posAtDOM(widget)
  view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
  view.focus()
}

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly block: boolean,
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.block === this.block
  }

  get estimatedHeight(): number {
    return this.block ? 90 : -1
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(this.block ? 'div' : 'span')
    element.className = this.block
      ? 'cm-md-math cm-md-math--block'
      : 'cm-md-math cm-md-math--inline'
    try {
      katex.render(this.tex, element, {
        displayMode: this.block,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'html',
      })
    } catch (error) {
      element.classList.add('cm-md-math--error')
      element.textContent = this.tex
      element.title = error instanceof Error ? error.message : '数学公式无法渲染'
    }
    element.addEventListener('mousedown', (event) => revealSource(element, view, event))
    return element
  }
}

export type ImageSourceKind = 'local' | 'remote' | 'data' | 'invalid'

export interface ImageWidgetSpec {
  kind: ImageSourceKind
  /** Loadable URL. Empty when the preview cannot load the source. */
  url: string
  /** Original Markdown destination, shown in fallbacks and tooltips. */
  source: string
  alt: string
  title: string
}

export class ImageWidget extends WidgetType {
  constructor(readonly spec: ImageWidgetSpec) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      other.spec.kind === this.spec.kind &&
      other.spec.url === this.spec.url &&
      other.spec.source === this.spec.source &&
      other.spec.alt === this.spec.alt &&
      other.spec.title === this.spec.title
    )
  }

  get estimatedHeight(): number {
    return this.spec.kind === 'remote' || this.spec.kind === 'invalid' ? 34 : -1
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = `cm-md-image cm-md-image--${this.spec.kind}`
    wrapper.title = this.spec.title || this.spec.source

    if (this.spec.kind === 'invalid' || !this.spec.url) {
      wrapper.appendChild(this.chip('图片不可用', this.spec.source))
      wrapper.addEventListener('mousedown', (event) => revealSource(wrapper, view, event))
      return wrapper
    }

    if (this.spec.kind === 'remote') {
      const button = this.chip('远程图片未加载 · 点击加载', this.spec.source)
      button.setAttribute('role', 'button')
      button.tabIndex = 0
      const load = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const image = this.image(view)
        image.src = this.spec.url
        wrapper.replaceChildren(image)
      }
      button.addEventListener('click', load)
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') load(event)
      })
      wrapper.appendChild(button)
      return wrapper
    }

    wrapper.appendChild(this.image(view))
    return wrapper
  }

  private image(view: EditorView): HTMLImageElement {
    const image = document.createElement('img')
    image.className = 'cm-md-image__img'
    image.alt = this.spec.alt
    image.title = this.spec.title
    image.loading = 'lazy'
    image.decoding = 'async'
    image.draggable = false
    image.referrerPolicy = 'no-referrer'
    image.src = this.spec.url
    image.addEventListener('error', () => {
      const fallback = document.createElement('span')
      fallback.className = 'cm-md-image__fallback'
      fallback.textContent = `图片无法加载 · ${this.spec.source}`
      image.replaceWith(fallback)
    })
    image.addEventListener('mousedown', (event) => revealSource(image, view, event))
    return image
  }

  private chip(label: string, detail: string): HTMLSpanElement {
    const chip = document.createElement('span')
    chip.className = 'cm-md-image__chip'
    const title = document.createElement('span')
    title.className = 'cm-md-image__chip-title'
    title.textContent = label
    const path = document.createElement('span')
    path.className = 'cm-md-image__chip-path'
    path.textContent = detail
    chip.append(title, path)
    return chip
  }
}
