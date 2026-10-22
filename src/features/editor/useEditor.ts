import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from 'vue'
import { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { useWorkspaceStore } from '@/stores/workspace'
import type { EditorHandle } from './editorRegistry'
import { registerEditor } from './editorRegistry'
import {
  applySourceMode,
  createEditorState,
  redoCommand,
  undoCommand,
} from './editorSetup'

interface Session {
  epoch: number
  sourceMode: boolean
  state: EditorState
  scrollTop: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useEditor(container: Ref<HTMLElement | null>) {
  const workspace = useWorkspaceStore()
  const view = shallowRef<EditorView | null>(null)
  const sessions = new Map<string, Session>()
  let boundId: string | null = null
  let unregister: (() => void) | null = null

  const scroller = () => view.value?.scrollDOM ?? null

  const handle: EditorHandle = {
    getSelection: () => {
      const current = view.value
      if (!current) return { from: 0, to: 0, text: '' }
      const range = current.state.selection.main
      return {
        from: range.from,
        to: range.to,
        text: current.state.sliceDoc(range.from, range.to),
      }
    },
    getCursor: () => {
      const current = view.value
      if (!current) return { line: 1, column: 1, offset: 0 }
      const range = current.state.selection.main
      const line = current.state.doc.lineAt(range.head)
      return { line: line.number, column: range.head - line.from + 1, offset: range.head }
    },
    getText: () => view.value?.state.doc.toString() ?? '',
    replaceRange: (from, to, insert, selectInsert = true) => {
      const current = view.value
      if (!current) return
      const length = current.state.doc.length
      const start = clamp(from, 0, length)
      const end = clamp(to, start, length)
      current.dispatch({
        changes: { from: start, to: end, insert },
        selection: selectInsert ? { anchor: start + insert.length } : undefined,
        scrollIntoView: true,
      })
      current.focus()
    },
    replaceAll: (text) => {
      const current = view.value
      if (!current) return
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: text },
        selection: { anchor: 0 },
      })
      current.focus()
    },
    focus: () => view.value?.focus(),
    scrollToPos: (pos) => {
      const current = view.value
      if (!current) return
      const safe = clamp(pos, 0, current.state.doc.length)
      current.dispatch({ effects: EditorView.scrollIntoView(safe, { y: 'center' }) })
    },
    coordsAtPos: (pos) => {
      const current = view.value
      if (!current) return null
      const coords = current.coordsAtPos(clamp(pos, 0, current.state.doc.length))
      if (!coords) return null
      return { left: coords.left, top: coords.top, bottom: coords.bottom }
    },
    undo: () => {
      if (view.value) undoCommand(view.value)
    },
    redo: () => {
      if (view.value) redoCommand(view.value)
    },
    selectRange: (from, to) => {
      const current = view.value
      if (!current) return
      const length = current.state.doc.length
      const start = clamp(from, 0, length)
      const end = clamp(to, start, length)
      current.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: true })
      current.focus()
    },
  }

  function bindHandle(documentId: string) {
    if (boundId === documentId && unregister) return
    unregister?.()
    unregister = registerEditor(documentId, handle)
    boundId = documentId
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === 'true') {
      ;(window as unknown as { __vesrioEditor?: EditorHandle }).__vesrioEditor = handle
    }
  }

  function ensureState(documentId: string) {
    const tab = workspace.tabs.find((item) => item.document.id === documentId)
    if (!tab) return null
    const existing = sessions.get(documentId)
    if (existing && existing.epoch === tab.docEpoch) return existing.state
    if (existing && scroller()) existing.scrollTop = scroller()?.scrollTop ?? existing.scrollTop
    const state = createEditorState(documentId, tab.editorText, {
      sourceMode: tab.sourceMode,
    })
    sessions.set(documentId, {
      epoch: tab.docEpoch,
      sourceMode: tab.sourceMode,
      state,
      scrollTop: 0,
    })
    return state
  }

  function sync() {
    const current = view.value
    const tab = workspace.activeTab
    if (!current || !tab) return
    const id = tab.document.id
    if (boundId && boundId !== id) {
      const previous = sessions.get(boundId)
      if (previous) previous.scrollTop = current.scrollDOM.scrollTop
    }
    let session = sessions.get(id)
    if (!session || session.epoch !== tab.docEpoch) {
      const state = ensureState(id)
      if (!state) return
      session = sessions.get(id)
      if (!session) return
      current.setState(session.state)
      requestAnimationFrame(() => {
        current.scrollDOM.scrollTop = session?.scrollTop ?? 0
      })
    } else if (boundId !== id) {
      current.setState(session.state)
      requestAnimationFrame(() => {
        current.scrollDOM.scrollTop = session?.scrollTop ?? 0
      })
    }
    if (session.sourceMode !== tab.sourceMode) {
      applySourceMode(current, tab.sourceMode)
      session.sourceMode = tab.sourceMode
    }
    bindHandle(id)
    const range = current.state.selection.main
    workspace.updateSelection(id, {
      from: range.from,
      to: range.to,
      text: current.state.sliceDoc(range.from, range.to),
    })
    const line = current.state.doc.lineAt(range.head)
    workspace.updateCursor(id, line.number, range.head - line.from + 1)
    current.focus()
  }

  onMounted(() => {
    const tab = workspace.activeTab
    if (!container.value || !tab) return
    const state = ensureState(tab.document.id)
    if (!state) return
    const instance = new EditorView({ state, parent: container.value })
    view.value = instance
    sync()
  })

  watch(
    () => [workspace.activeId, workspace.activeTab?.docEpoch, workspace.activeTab?.sourceMode],
    () => sync(),
    { flush: 'post' },
  )

  watch(
    () => workspace.tabs.map((tab) => tab.document.id),
    (ids) => {
      for (const key of [...sessions.keys()]) {
        if (!ids.includes(key)) sessions.delete(key)
      }
    },
  )

  onBeforeUnmount(() => {
    unregister?.()
    if (import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === 'true') {
      delete (window as unknown as { __vesrioEditor?: EditorHandle }).__vesrioEditor
    }
    view.value?.destroy()
    view.value = null
    sessions.clear()
  })

  return { view, handle }
}
