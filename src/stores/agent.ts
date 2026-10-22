import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { friendlyMessage } from '@/lib/errors'
import type { Citation, MessageRecord, PreparedChat } from '@/lib/types'
import { getEditor } from '@/features/editor/editorRegistry'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

export type ChatScope = 'selection' | 'document'
export type ChatStage = 'compose' | 'preview' | 'sending' | 'error'

export interface ChatDraft {
  question: string
  scope: ChatScope
  stage: ChatStage
  prepared: PreparedChat | null
  preparing: boolean
  error: string
}

function initialDraft(): ChatDraft {
  return {
    question: '',
    scope: 'document',
    stage: 'compose',
    prepared: null,
    preparing: false,
    error: '',
  }
}

export const useAgentStore = defineStore('agent', {
  state: () => ({
    documentId: null as string | null,
    conversationId: null as string | null,
    messages: [] as MessageRecord[],
    citationsByMessage: {} as Record<string, Citation[]>,
    draft: initialDraft() as ChatDraft,
    generating: false,
    requestId: null as string | null,
    streaming: '',
    error: '',
    loading: false,
  }),
  actions: {
    async loadForDocument(documentId: string) {
      if (this.documentId === documentId && this.conversationId) return
      this.documentId = documentId
      this.conversationId = null
      this.messages = []
      this.citationsByMessage = {}
      this.streaming = ''
      this.error = ''
      this.draft = initialDraft()
      const workspace = useWorkspaceStore()
      this.loading = true
      try {
        const conversation = await api.getConversation(documentId, workspace.project?.id ?? null)
        this.conversationId = conversation.id
        const messages = await api.listMessages(conversation.id)
        this.messages = messages
        for (const message of messages) {
          if (Array.isArray(message.citations)) {
            this.citationsByMessage[message.id] = message.citations
          }
        }
      } catch (error) {
        this.error = friendlyMessage(error)
      } finally {
        this.loading = false
      }
    },
    setDraft(patch: Partial<ChatDraft>) {
      this.draft = { ...this.draft, ...patch }
    },
    resetDraft() {
      this.draft = initialDraft()
    },
    async prepare() {
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!tab) return null
      const question = this.draft.question.trim()
      if (!question) {
        this.draft.error = '请输入问题。'
        this.draft.stage = 'error'
        return null
      }
      const editor = getEditor(tab.document.id)
      const selection = editor?.getSelection() ?? tab.selection
      const text = editor?.getText() ?? tab.editorText
      if (this.draft.scope === 'selection' && !selection.text.trim()) {
        this.draft.error = '请先选中要讨论的文字。'
        this.draft.stage = 'error'
        return null
      }
      this.draft.preparing = true
      this.draft.error = ''
      try {
        const prepared = await api.prepareChat({
          documentId: tab.document.id,
          projectId: workspace.project?.id ?? null,
          documentTitle: tab.document.title,
          documentText: text,
          question,
          readScope: this.draft.scope,
          fromUtf16: this.draft.scope === 'selection' ? selection.from : null,
          toUtf16: this.draft.scope === 'selection' ? selection.to : null,
        })
        this.draft.prepared = prepared
        this.draft.stage = 'preview'
        return prepared
      } catch (error) {
        this.draft.error = friendlyMessage(error)
        this.draft.stage = 'error'
        return null
      } finally {
        this.draft.preparing = false
      }
    },
    async send() {
      const prepared = this.draft.prepared
      if (!prepared) {
        const next = await this.prepare()
        if (!next) return null
      }
      const request = this.draft.prepared
      if (!request) return null
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!tab) return null
      const editor = getEditor(tab.document.id)
      const documentText = editor?.getText() ?? tab.editorText
      const question = this.draft.question.trim()
      this.conversationId = request.conversationId
      this.messages.push({
        id: `local-${Date.now()}`,
        conversationId: request.conversationId,
        role: 'user',
        content: question,
        citations: [],
        createdAt: new Date().toISOString(),
      })
      this.setDraft({ stage: 'sending', prepared: null, question: '' })
      this.generating = true
      this.requestId = request.requestId
      this.streaming = ''
      this.error = ''
      try {
        const result = await api.executeChat(request.requestId, documentText)
        this.messages.push(result.message)
        this.citationsByMessage[result.message.id] = result.message.citations ?? []
        this.generating = false
        this.requestId = null
        this.streaming = ''
        this.resetDraft()
        return result
      } catch (error) {
        this.generating = false
        this.requestId = null
        this.streaming = ''
        this.error = friendlyMessage(error)
        this.draft = {
          question,
          scope: this.draft.scope,
          stage: 'error',
          prepared: null,
          preparing: false,
          error: friendlyMessage(error),
        }
        if (this.error !== '已取消。') useUiStore().error('对话失败', this.error)
        return null
      }
    },
    onDelta(requestId: string, delta: string) {
      if (this.requestId !== requestId) return
      this.streaming += delta
    },
    async cancel() {
      if (this.requestId) {
        try {
          await api.cancelRequest(this.requestId)
        } catch {
          // best effort
        }
      }
      this.generating = false
      this.requestId = null
      this.streaming = ''
    },
    jumpToCitation(citation: Citation) {
      if (!citation.resolved) {
        useUiStore().warn('引用来源已变化', '原文中找不到这段文字，可能已被修改。')
        return
      }
      const workspace = useWorkspaceStore()
      const tab = workspace.activeTab
      if (!tab) return
      const editor = getEditor(tab.document.id)
      if (!editor) return
      editor.focus()
      editor.selectRange(citation.fromUtf16, citation.toUtf16)
      editor.scrollToPos(citation.fromUtf16)
    },
    setCitations(messageId: string, citations: Citation[]) {
      this.citationsByMessage[messageId] = citations
    },
  },
})
