import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  rectangularSelection,
  type ViewUpdate,
} from '@codemirror/view'
import { useSettingsStore } from '@/stores/settings'
import { useWorkspaceStore } from '@/stores/workspace'
import { editorHighlighting, editorTheme } from './editorTheme'
import { blockMathExtension } from './markdownBlockMath'
import { documentPathFacet, markdownLivePreview } from './markdownLivePreview'

export const sourceModeCompartment = new Compartment()
export const documentPathCompartment = new Compartment()

function baseExtensions(): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }),
    // Long prose (and long link labels) wraps by default instead of scrolling.
    EditorView.lineWrapping,
    editorTheme,
    editorHighlighting,
  ]
}

export function sourceModeExtension(enabled: boolean): Extension {
  return enabled ? [] : [markdownLivePreview, blockMathExtension]
}

export function createEditorState(
  documentId: string,
  text: string,
  options: { sourceMode: boolean; documentPath: string },
): EditorState {
  const workspace = useWorkspaceStore()
  const settings = useSettingsStore()
  const listener = (update: ViewUpdate) => {
    if (update.docChanged) {
      workspace.updateText(documentId, update.state.doc.toString())
    }
    if (update.selectionSet || update.docChanged) {
      const range = update.state.selection.main
      workspace.updateSelection(documentId, {
        from: range.from,
        to: range.to,
        text: update.state.sliceDoc(range.from, range.to),
      })
      const line = update.state.doc.lineAt(range.head)
      workspace.updateCursor(documentId, line.number, range.head - line.from + 1)
      if (settings.typewriterMode && update.selectionSet) {
        requestAnimationFrame(() => {
          if (update.view.hasFocus) {
            update.view.dispatch({
              effects: EditorView.scrollIntoView(range.head, { y: 'center' }),
            })
          }
        })
      }
    }
  }
  return EditorState.create({
    doc: text,
    extensions: [
      ...baseExtensions(),
      highlightActiveLine(),
      sourceModeCompartment.of(sourceModeExtension(options.sourceMode)),
      documentPathCompartment.of(documentPathFacet.of(options.documentPath)),
      EditorView.updateListener.of(listener),
    ],
  })
}

export function applySourceMode(view: EditorView, enabled: boolean) {
  view.dispatch({
    effects: sourceModeCompartment.reconfigure(sourceModeExtension(enabled)),
  })
}

export function applyDocumentPath(view: EditorView, documentPath: string) {
  view.dispatch({
    effects: documentPathCompartment.reconfigure(documentPathFacet.of(documentPath)),
  })
}

export function undoCommand(view: EditorView): boolean {
  return undo(view)
}

export function redoCommand(view: EditorView): boolean {
  return redo(view)
}
