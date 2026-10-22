export interface EditorHandle {
  getSelection: () => { from: number; to: number; text: string }
  getCursor: () => { line: number; column: number; offset: number }
  getText: () => string
  replaceRange: (from: number, to: number, insert: string, selectInsert?: boolean) => void
  replaceAll: (text: string) => void
  focus: () => void
  scrollToPos: (pos: number, options?: { highlight?: boolean }) => void
  coordsAtPos: (pos: number) => { left: number; top: number; bottom: number } | null
  undo: () => void
  redo: () => void
  selectRange: (from: number, to: number) => void
}

const handles = new Map<string, EditorHandle>()

export function registerEditor(documentId: string, handle: EditorHandle): () => void {
  handles.set(documentId, handle)
  return () => {
    if (handles.get(documentId) === handle) handles.delete(documentId)
  }
}

export function getEditor(documentId: string | null | undefined): EditorHandle | null {
  if (!documentId) return null
  return handles.get(documentId) ?? null
}

export function editorText(documentId: string | null | undefined): string | null {
  const handle = getEditor(documentId)
  return handle ? handle.getText() : null
}
