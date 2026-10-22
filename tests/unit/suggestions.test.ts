import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DocumentView, SuggestionView } from '@/lib/types'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  isTauri: () => true,
  hasBackend: () => true,
  api: {
    prepareSuggestion: vi.fn(),
    executeSuggestion: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue(undefined),
    markSuggestionStale: vi.fn(),
    rejectSuggestion: vi.fn(),
    applySuggestion: vi.fn(),
    listSuggestions: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({}),
    setSettings: vi.fn().mockResolvedValue({}),
    listRecentDocuments: vi.fn().mockResolvedValue([]),
  },
  onAiEvent: vi.fn(),
  reportError: vi.fn(),
}))

import { api } from '@/lib/api'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useWorkspaceStore } from '@/stores/workspace'

function view(overrides: Partial<DocumentView> = {}): DocumentView {
  return {
    id: 'doc-1',
    path: 'C:\\book\\chapter.md',
    title: 'chapter',
    text: '构建适配需要对原有软件进行一定程度的调整',
    encoding: 'utf-8',
    eol: 'lf',
    bom: false,
    diskHash: 'hash-1',
    contentHash: 'content-1',
    revision: 1,
    size: 24,
    modifiedMs: null,
    readOnly: false,
    written: false,
    warnings: [],
    ...overrides,
  }
}

function suggestion(): SuggestionView {
  return {
    id: 'suggestion-1',
    requestId: 'request-1',
    documentId: 'doc-1',
    fromUtf16: 0,
    toUtf16: 24,
    selectedTextHash: 'hash',
    originalText: '构建适配需要对原有软件进行一定程度的调整',
    candidateText: '构建适配包括编译参数调整。',
    rationale: '精简',
    warnings: [],
    status: 'ready',
    selectedCandidate: 0,
    candidates: [{ idx: 0, candidateText: '构建适配包括编译参数调整。', rationale: '精简' }],
    baseRevision: 1,
    snapshotId: null,
    createdAt: new Date().toISOString(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function boot() {
  const workspace = useWorkspaceStore()
  workspace.addTab(view())
  const suggestions = useSuggestionsStore()
  suggestions.draft = {
    ...suggestions.draft,
    open: true,
    documentId: 'doc-1',
    selection: { from: 0, to: 24, text: '构建适配需要对原有软件进行一定程度的调整' },
    intent: 'shorten',
    prepared: {
      requestId: 'request-1',
      messages: [],
      outboundChars: 0,
      readScope: 'selection',
      writeScope: 'selection_only',
      model: 'test',
      providerHost: 'test.local',
      baseRevision: 1,
    },
  }
  return { workspace, suggestions }
}

describe('suggestions store streaming cancellation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not resurrect a suggestion card after the user cancels', async () => {
    const pending = deferred<SuggestionView>()
    vi.mocked(api.executeSuggestion).mockReturnValue(pending.promise)
    const { suggestions } = boot()

    const send = suggestions.send()
    expect(suggestions.generating).toBe(true)
    expect(suggestions.cardVisible).toBe(true)

    await suggestions.cancel()
    expect(suggestions.generating).toBe(false)
    expect(suggestions.cardVisible).toBe(false)

    pending.resolve(suggestion())
    await send

    expect(suggestions.currentByDocument['doc-1']).toBeNull()
    expect(suggestions.generating).toBe(false)
  })

  it('ignores a late cancellation error and keeps the card hidden', async () => {
    const pending = deferred<SuggestionView>()
    vi.mocked(api.executeSuggestion).mockReturnValue(pending.promise)
    const { suggestions } = boot()

    const send = suggestions.send()
    await suggestions.cancel()
    pending.reject({ code: 'cancelled', message: '已取消', retryable: false })
    await send

    expect(suggestions.currentByDocument['doc-1']).toBeNull()
    expect(suggestions.error).toBe('')
  })

  it('still shows a suggestion that completes without cancellation', async () => {
    vi.mocked(api.executeSuggestion).mockResolvedValue(suggestion())
    const { suggestions } = boot()

    await suggestions.send()

    expect(suggestions.generating).toBe(false)
    expect(suggestions.currentByDocument['doc-1']?.status).toBe('ready')
    expect(suggestions.cardVisible).toBe(true)
  })
})
