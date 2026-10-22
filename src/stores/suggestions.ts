import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { friendlyMessage, normalizeError } from '@/lib/errors'
import type {
  EditorSelection,
  PreparedRequest,
  SuggestionView,
} from '@/lib/types'
import { getEditor } from '@/features/editor/editorRegistry'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

export type InlineAiStage = 'compose' | 'preview' | 'sending' | 'error'
export type ReadScope = 'selection' | 'selection_with_paragraph_context' | 'document'

export interface InlineAiDraft {
  open: boolean
  documentId: string
  selection: EditorSelection
  instruction: string
  intent: string
  scope: ReadScope
  count: number
  stage: InlineAiStage
  preparing: boolean
  prepared: PreparedRequest | null
  error: string
}

function emptyDraft(): InlineAiDraft {
  return {
    open: false,
    documentId: '',
    selection: { from: 0, to: 0, text: '' },
    instruction: '',
    intent: 'custom',
    scope: 'selection',
    count: 1,
    stage: 'compose',
    preparing: false,
    prepared: null,
    error: '',
  }
}

export const useSuggestionsStore = defineStore('suggestions', {
  state: () => ({
    draft: emptyDraft() as InlineAiDraft,
    currentByDocument: {} as Record<string, SuggestionView | null>,
    streamingByDocument: {} as Record<string, string>,
    anchorByDocument: {} as Record<string, { from: number; to: number }>,
    requestId: null as string | null,
    requestDocumentId: null as string | null,
    generating: false,
    error: '',
    lastInstructionByDocument: {} as Record<string, string>,
  }),
  getters: {
    activeSuggestion(state): SuggestionView | null {
      const workspace = useWorkspaceStore()
      const id = workspace.activeId
      return id ? state.currentByDocument[id] ?? null : null
    },
    streaming(state): string {
      const workspace = useWorkspaceStore()
      return workspace.activeId ? state.streamingByDocument[workspace.activeId] ?? '' : ''
    },
    cardVisible(state): boolean {
      const workspace = useWorkspaceStore()
      const id = workspace.activeId
      if (!id) return false
      if (state.generating && state.requestDocumentId === id) return true
      return Boolean(state.currentByDocument[id])
    },
  },
  actions: {
    openDraft(selection: EditorSelection, instruction = '', intent = 'custom') {
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!tab) return false
      if (!selection.text.trim()) {
        useUiStore().warn('请先选中要修改的文字')
        return false
      }
      this.draft = {
        ...emptyDraft(),
        open: true,
        documentId: tab.document.id,
        selection: { ...selection },
        instruction,
        intent,
      }
      return true
    },
    openDraftFromEditor(instruction = '', intent = 'custom') {
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!tab) return false
      const editor = getEditor(tab.document.id)
      const selection = editor?.getSelection() ?? tab.selection
      return this.openDraft(selection, instruction, intent)
    },
    closeDraft() {
      this.draft = emptyDraft()
    },
    setDraft(patch: Partial<InlineAiDraft>) {
      this.draft = { ...this.draft, ...patch }
    },
    async prepare() {
      const workspace = useWorkspaceStore()
      const tab = workspace.tabs.find((item) => item.document.id === this.draft.documentId)
      if (!tab) {
        this.draft.error = '文档已关闭，请重新选择。'
        this.draft.stage = 'error'
        return null
      }
      const editor = getEditor(tab.document.id)
      const text = editor?.getText() ?? tab.editorText
      const selection = this.draft.selection
      const currentSelection = editor?.getSelection()
      if (currentSelection && currentSelection.text && currentSelection.text !== selection.text) {
        this.draft.error = '选区已变化，请重新选择后再试。'
        this.draft.stage = 'error'
        return null
      }
      const slice = text.slice(selection.from, selection.to)
      if (slice !== selection.text) {
        this.draft.error = '选区内容已变化，请重新选择后再试。'
        this.draft.stage = 'error'
        return null
      }
      if (!this.draft.instruction.trim() && this.draft.intent === 'custom') {
        this.draft.error = '请填写修改指令。'
        this.draft.stage = 'error'
        return null
      }
      this.draft.preparing = true
      this.draft.error = ''
      try {
        const prepared = await api.prepareSuggestion({
          documentId: tab.document.id,
          projectId: workspace.project?.id ?? null,
          documentTitle: tab.document.title,
          documentText: text,
          instruction: this.instructionForPrompt(),
          intent: this.draft.intent,
          candidateCount: this.draft.count,
          readScope: this.draft.scope,
          fromUtf16: selection.from,
          toUtf16: selection.to,
          selectedTextSha256: null,
          editRevision: tab.editRevision,
        })
        this.draft.prepared = prepared
        this.draft.stage = 'preview'
        this.anchorByDocument[tab.document.id] = {
          from: selection.from,
          to: selection.to,
        }
        return prepared
      } catch (error) {
        this.draft.error = friendlyMessage(error)
        this.draft.stage = 'error'
        return null
      } finally {
        this.draft.preparing = false
      }
    },
    instructionForPrompt(): string {
      const presets: Record<string, string> = {
        shorten: '精简表达，保留原意与技术事实。',
        polish: '润色文字，让表达更自然、准确，保留作者语气。',
        rewrite: '改写这段文字，使逻辑更清晰，但不要引入新事实。',
      }
      if (this.draft.instruction.trim()) {
        return this.draft.instruction.trim()
      }
      return presets[this.draft.intent] ?? ''
    },
    async confirmAndSend() {
      const settings = useSettingsStore()
      if (!this.draft.prepared) {
        const prepared = await this.prepare()
        if (!prepared) return
      }
      if (settings.confirmBeforeSend) {
        this.draft.stage = 'preview'
        return
      }
      await this.send()
    },
    async send() {
      const prepared = this.draft.prepared
      if (!prepared) return null
      this.draft.stage = 'sending'
      this.generating = true
      this.requestId = prepared.requestId
      this.requestDocumentId = this.draft.documentId
      this.streamingByDocument[this.draft.documentId] = ''
      this.lastInstructionByDocument[this.draft.documentId] = this.instructionForPrompt()
      const documentId = this.draft.documentId
      this.closeDraft()
      try {
        const suggestion = await api.executeSuggestion(prepared.requestId)
        // Cancelling (or starting another request) invalidates this result: a
        // late response must never resurrect a dismissed suggestion card.
        if (this.requestId !== prepared.requestId) return null
        return this.finish(documentId, suggestion, prepared.baseRevision)
      } catch (error) {
        if (this.requestId !== prepared.requestId) return null
        this.generating = false
        this.requestId = null
        this.error = friendlyMessage(error)
        const normalized = normalizeError(error)
        this.currentByDocument[documentId] = {
          id: '',
          requestId: prepared.requestId,
          documentId,
          fromUtf16: 0,
          toUtf16: 0,
          selectedTextHash: '',
          originalText: '',
          candidateText: '',
          rationale: '',
          warnings: [],
          status: normalized.code === 'cancelled' ? 'canceled' : 'failed',
          selectedCandidate: 0,
          candidates: [],
          baseRevision: prepared.baseRevision,
          snapshotId: null,
          createdAt: new Date().toISOString(),
        }
        if (normalized.code !== 'cancelled') {
          useUiStore().error('建议生成失败', friendlyMessage(error))
        }
        return null
      }
    },
    async finish(documentId: string, suggestion: SuggestionView, baseRevision: number) {
      this.generating = false
      this.requestId = null
      this.streamingByDocument[documentId] = ''
      const workspace = useWorkspaceStore()
      const tab = workspace.tabs.find((item) => item.document.id === documentId)
      let view = suggestion
      if (tab && tab.editRevision !== baseRevision) {
        try {
          view = await api.markSuggestionStale(suggestion.id)
        } catch {
          view = { ...suggestion, status: 'stale' }
        }
      }
      this.currentByDocument[documentId] = { ...view }
      return view
    },
    onDelta(requestId: string, delta: string) {
      if (this.requestId !== requestId || !this.requestDocumentId) return
      const current = this.streamingByDocument[this.requestDocumentId] ?? ''
      this.streamingByDocument[this.requestDocumentId] = current + delta
    },
    onSuggestionEvent(suggestion: SuggestionView) {
      if (this.requestId !== suggestion.requestId) return
      const workspace = useWorkspaceStore()
      const tab = workspace.tabs.find((item) => item.document.id === suggestion.documentId)
      const view =
        tab && tab.editRevision !== suggestion.baseRevision
          ? { ...suggestion, status: 'stale' as const }
          : suggestion
      this.currentByDocument[suggestion.documentId] = { ...view }
      this.generating = false
      this.requestId = null
      this.streamingByDocument[suggestion.documentId] = ''
    },
    async cancel() {
      if (this.requestId) {
        try {
          await api.cancelRequest(this.requestId)
        } catch {
          // cancellation is best-effort; the stream also stops on timeout
        }
      }
      this.generating = false
      this.requestId = null
      if (this.requestDocumentId) {
        this.streamingByDocument[this.requestDocumentId] = ''
        this.currentByDocument[this.requestDocumentId] = null
      }
    },
    closeCard() {
      const workspace = useWorkspaceStore()
      if (!workspace.activeId) return
      this.currentByDocument[workspace.activeId] = null
    },
    async reject() {
      const suggestion = this.activeSuggestion
      if (!suggestion || !suggestion.id) {
        this.closeCard()
        return
      }
      try {
        const updated = await api.rejectSuggestion(suggestion.id)
        this.currentByDocument[updated.documentId] = null
        useUiStore().toast('info', '已拒绝该建议，正文未改变')
      } catch (error) {
        useUiStore().error('拒绝失败', friendlyMessage(error))
      }
    },
    async accept(candidateIndex?: number) {
      const suggestion = this.activeSuggestion
      if (!suggestion || !suggestion.id) return
      if (suggestion.status !== 'ready') {
        useUiStore().warn('当前建议不可应用')
        return
      }
      const workspace = useWorkspaceStore()
      const tab = workspace.tabs.find((item) => item.document.id === suggestion.documentId)
      if (!tab) return
      const editor = getEditor(tab.document.id)
      if (!editor) {
        useUiStore().error('编辑器未就绪，无法应用')
        return
      }
      const index = candidateIndex ?? suggestion.selectedCandidate ?? 0
      const candidate = suggestion.candidates.find((item) => item.idx === index)
      if (!candidate) {
        useUiStore().error('候选不存在')
        return
      }
      const documentText = editor.getText()
      try {
        const outcome = await api.applySuggestion(
          suggestion.id,
          tab.document.id,
          index,
          documentText,
          tab.editRevision,
        )
        if (outcome.alreadyApplied) {
          this.currentByDocument[tab.document.id] = null
          return
        }
        editor.replaceRange(suggestion.fromUtf16, suggestion.toUtf16, candidate.candidateText, true)
        const actual = editor.getText()
        if (actual !== outcome.newText) {
          editor.undo()
          useUiStore().error('文档在应用时发生了变化，已撤销本次应用')
          return
        }
        this.currentByDocument[tab.document.id] = null
        workspace.snapshotRevision += 1
        const ui = useUiStore()
        ui.success('已接受建议', '可立即按 Ctrl+Z 撤销，保存后写入磁盘')
        if (useSettingsStore().autoSnapshot) {
          useUiStore().toast('info', '应用前已自动创建快照', '可在右侧「修订」中恢复')
        }
      } catch (error) {
        const normalized = normalizeError(error)
        if (normalized.code === 'stale_suggestion') {
          try {
            const updated = await api.markSuggestionStale(suggestion.id)
            // Always store a fresh object: the backend (or the dev mock) may
            // return the same instance it mutated, which would not trigger Vue.
            this.currentByDocument[tab.document.id] = { ...updated, status: 'stale' }
          } catch {
            this.currentByDocument[tab.document.id] = { ...suggestion, status: 'stale' }
          }
          useUiStore().warn('原文已变化，旧建议不能应用')
        } else {
          useUiStore().error('应用建议失败', friendlyMessage(error))
        }
      }
    },
    async regenerate() {
      const suggestion = this.activeSuggestion
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!suggestion || !tab) return
      const instruction =
        this.lastInstructionByDocument[tab.document.id] ?? suggestion.rationale
      this.currentByDocument[tab.document.id] = null
      this.openDraft(
        {
          from: suggestion.fromUtf16,
          to: suggestion.toUtf16,
          text: suggestion.originalText,
        },
        instruction,
        'custom',
      )
    },
    async loadForDocument(documentId: string) {
      try {
        const list = await api.listSuggestions(documentId)
        const latest = list.find(
          (item) => item.status === 'ready' || item.status === 'stale',
        )
        if (latest) this.currentByDocument[documentId] = { ...latest }
      } catch {
        // History is optional on first open.
      }
    },
  },
})
