import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DocumentView } from '@/lib/types'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  isTauri: () => true,
  hasBackend: () => true,
  api: {
    saveDocument: vi.fn(),
    saveDocumentAs: vi.fn(),
    listRecentDocuments: vi.fn().mockResolvedValue([]),
    setSettings: vi.fn().mockResolvedValue({}),
    getSettings: vi.fn().mockResolvedValue({}),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    openDocument: vi.fn(),
    openProject: vi.fn(),
    scanFolder: vi.fn(),
    checkExternalChange: vi.fn(),
    reloadDocument: vi.fn(),
    createSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
  },
  onAiEvent: vi.fn(),
  reportError: vi.fn(),
}))

import { api } from '@/lib/api'
import { useWorkspaceStore } from '@/stores/workspace'

function view(overrides: Partial<DocumentView> = {}): DocumentView {
  return {
    id: 'doc-1',
    path: 'C:\\book\\chapter.md',
    title: 'chapter',
    text: '原文',
    encoding: 'utf-8',
    eol: 'lf',
    bom: false,
    diskHash: 'hash-1',
    contentHash: 'content-1',
    revision: 1,
    size: 6,
    modifiedMs: null,
    readOnly: false,
    written: false,
    warnings: [],
    ...overrides,
  }
}

describe('workspace store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(api.listRecentDocuments).mockResolvedValue([])
    vi.mocked(api.setSettings).mockResolvedValue({})
  })

  it('opens a tab and tracks dirty state', () => {
    const workspace = useWorkspaceStore()
    workspace.addTab(view())
    expect(workspace.activeId).toBe('doc-1')
    expect(workspace.activeTab?.dirty).toBe(false)
    workspace.updateText('doc-1', '修改后的原文')
    expect(workspace.activeTab?.dirty).toBe(true)
    expect(workspace.activeTab?.saveState).toBe('dirty')
    expect(workspace.activeTab?.editRevision).toBe(2)
  })

  it('saves and adopts the returned document fingerprint', async () => {
    const workspace = useWorkspaceStore()
    workspace.addTab(view())
    workspace.updateText('doc-1', '修改后的原文')
    vi.mocked(api.saveDocument).mockResolvedValue({
      document: view({ text: '修改后的原文', diskHash: 'hash-2', revision: 2 }),
      wrote: true,
      bytesWritten: 18,
    })
    const outcome = await workspace.save()
    expect(outcome?.wrote).toBe(true)
    expect(api.saveDocument).toHaveBeenCalledWith('doc-1', '修改后的原文', 'hash-1', false)
    expect(workspace.activeTab?.dirty).toBe(false)
    expect(workspace.activeTab?.document.diskHash).toBe('hash-2')
    expect(workspace.activeTab?.saveState).toBe('saved')
  })

  it('surfaces an external conflict and keeps unsaved content', async () => {
    const workspace = useWorkspaceStore()
    workspace.addTab(view())
    workspace.updateText('doc-1', '本地修改')
    vi.mocked(api.saveDocument).mockRejectedValue({
      code: 'external_conflict',
      message: 'changed',
      details: { diskHash: 'disk-2', expectedHash: 'hash-1' },
    })
    await expect(workspace.save()).rejects.toMatchObject({ code: 'external_conflict' })
    const tab = workspace.activeTab
    expect(tab?.dirty).toBe(true)
    expect(tab?.saveState).toBe('conflict')
    expect(tab?.editorText).toBe('本地修改')
    expect(tab?.document.diskHash).toBe('hash-1')
    expect(tab?.externalChange?.diskHash).toBe('disk-2')
  })

  it('bumps snapshotRevision when a manual snapshot is created', async () => {
    const workspace = useWorkspaceStore()
    workspace.addTab(view())
    vi.mocked(api.createSnapshot).mockResolvedValue({
      id: 'snapshot-1',
      documentId: 'doc-1',
      contentHash: 'hash',
      source: 'manual',
      sizeBytes: 6,
      createdAt: new Date().toISOString(),
    })
    await workspace.createManualSnapshot()
    expect(workspace.snapshotRevision).toBe(1)
  })

  it('does not lose edits when save fails for an IO reason', async () => {
    const workspace = useWorkspaceStore()
    workspace.addTab(view())
    workspace.updateText('doc-1', '还没保存')
    vi.mocked(api.saveDocument).mockRejectedValue({ code: 'io_error', message: 'disk full' })
    await expect(workspace.save()).rejects.toBeTruthy()
    expect(workspace.activeTab?.editorText).toBe('还没保存')
    expect(workspace.activeTab?.dirty).toBe(true)
    expect(workspace.activeTab?.saveState).toBe('error')
  })
})
