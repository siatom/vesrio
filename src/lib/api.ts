import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ApplyOutcome,
  AppInfo,
  AppSettings,
  CaptionButtonRect,
  ChatResult,
  ConversationRecord,
  DocumentView,
  ExternalChange,
  FileNode,
  MessageRecord,
  PreparedChat,
  PreparedRequest,
  Project,
  ProjectWorkspace,
  ProviderConfig,
  ProviderConfigView,
  ProviderTestResult,
  RecentEntry,
  RestoreOutcome,
  SaveOutcome,
  SnapshotFile,
  SnapshotRecord,
  StyleProfile,
  StyleRules,
  SuggestionView,
} from './types'

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const mockMode = import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === 'true'

/** True when a backend exists, including the development-only mock. */
export function hasBackend(): boolean {
  return isTauri() || mockMode
}

function desktopOnly(): never {
  throw {
    code: 'desktop_only',
    message: '此功能需要在 Vesrio 桌面应用中运行。',
    retryable: false,
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    if (mockMode) {
      const { mockInvoke } = await import('./mockBackend')
      return mockInvoke<T>(command, args)
    }
    desktopOnly()
  }
  return invoke<T>(command, args)
}

export const api = {
  appInfo: () => call<AppInfo>('get_app_info'),

  // Windows only: lets the native hit test expose the self-drawn maximize
  // button as HTMAXBUTTON so Windows 11 shows Snap Layouts on hover.
  setCaptionButtonRect: (rect: CaptionButtonRect | null) =>
    call<void>('set_caption_button_rect', { rect }),

  openDocument: (path: string, projectId?: string | null, convertEncoding?: string | null) =>
    call<DocumentView>('open_document', {
      path,
      projectId: projectId ?? null,
      convertEncoding: convertEncoding ?? null,
    }),
  convertDocumentEncoding: (path: string, encoding: string) =>
    call<DocumentView>('convert_document_encoding', { path, encoding }),
  createDocument: (path: string) => call<DocumentView>('create_document', { path }),
  saveDocument: (
    id: string,
    text: string,
    expectedDiskHash: string | null,
    force = false,
  ) => call<SaveOutcome>('save_document', { id, text, expectedDiskHash, force }),
  saveDocumentAs: (id: string, path: string, text: string, force = false) =>
    call<SaveOutcome>('save_document_as', { id, path, text, force }),
  checkExternalChange: (id: string) => call<ExternalChange>('check_external_change', { id }),
  reloadDocument: (id: string) => call<DocumentView>('reload_document', { id }),
  closeDocument: (id: string) => call<void>('close_document', { id }),

  scanFolder: (path: string) => call<FileNode>('scan_folder', { path }),
  openProject: (path: string) => call<ProjectWorkspace>('open_project', { path }),
  listProjects: () => call<Project[]>('list_projects'),
  listRecentDocuments: () => call<RecentEntry[]>('list_recent_documents'),

  getSettings: () => call<Record<string, unknown>>('get_settings'),
  setSettings: (values: Partial<AppSettings>) =>
    call<Record<string, unknown>>('set_settings', { values }),

  getProviderConfig: () => call<ProviderConfigView>('get_provider_config'),
  saveProviderConfig: (
    config: ProviderConfig,
    apiKey?: string | null,
    removeApiKey = false,
  ) =>
    call<ProviderConfigView>('save_provider_config', {
      config,
      apiKey: apiKey && apiKey.length > 0 ? apiKey : null,
      removeApiKey,
    }),
  testProvider: () => call<ProviderTestResult>('test_provider'),

  prepareSuggestion: (input: Record<string, unknown>) =>
    call<PreparedRequest>('prepare_suggestion', { input }),
  executeSuggestion: (requestId: string) =>
    call<SuggestionView>('execute_suggestion', { requestId }),
  cancelRequest: (requestId: string) => call<void>('cancel_request', { requestId }),
  rejectSuggestion: (suggestionId: string) =>
    call<SuggestionView>('reject_suggestion', { suggestionId }),
  markSuggestionStale: (suggestionId: string) =>
    call<SuggestionView>('mark_suggestion_stale', { suggestionId }),
  applySuggestion: (
    suggestionId: string,
    documentId: string,
    candidateIndex: number,
    documentText: string,
    editRevision: number,
  ) =>
    call<ApplyOutcome>('apply_suggestion', {
      suggestionId,
      documentId,
      candidateIndex,
      documentText,
      editRevision,
    }),
  listSuggestions: (documentId: string) =>
    call<SuggestionView[]>('list_suggestions', { documentId }),

  prepareChat: (input: Record<string, unknown>) =>
    call<PreparedChat>('prepare_chat', { input }),
  executeChat: (requestId: string, documentText: string) =>
    call<ChatResult>('execute_chat', { requestId, documentText }),
  listMessages: (conversationId: string) =>
    call<MessageRecord[]>('list_messages', { conversationId }),
  listConversations: (documentId: string) =>
    call<ConversationRecord[]>('list_conversations', { documentId }),
  getConversation: (documentId: string, projectId?: string | null) =>
    call<ConversationRecord>('get_conversation', { documentId, projectId: projectId ?? null }),

  createSnapshot: (documentId: string, content: string, source: string) =>
    call<SnapshotRecord>('create_snapshot', { documentId, content, source }),
  listSnapshots: (documentId: string) =>
    call<SnapshotRecord[]>('list_snapshots', { documentId }),
  readSnapshot: (snapshotId: string) =>
    call<SnapshotFile>('read_snapshot', { snapshotId }),
  restoreSnapshot: (snapshotId: string, currentText: string) =>
    call<RestoreOutcome>('restore_snapshot', { snapshotId, currentText }),

  getStyleProfile: (projectId: string) =>
    call<StyleProfile>('get_style_profile', { projectId }),
  saveStyleProfile: (projectId: string, rules: StyleRules) =>
    call<StyleProfile>('save_style_profile', { projectId, rules }),

  reportClientEvent: (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) =>
    call<void>('report_client_event', { level, event, fields }),

  debugPaths: () => call<Record<string, string>>('debug_paths'),
}

export function onAiEvent<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri()) {
    if (mockMode) {
      return import('./mockBackend').then(({ mockListen }) =>
        mockListen(event, handler as (payload: unknown) => void),
      )
    }
    return Promise.resolve(() => {})
  }
  return listen<T>(event, (message) => handler(message.payload))
}

export async function reportError(event: string, error: unknown): Promise<void> {
  try {
    const payload = error as { code?: string; message?: string }
    await api.reportClientEvent('error', event, {
      code: payload?.code ?? 'unknown',
      message: payload?.message ?? String(error),
    })
  } catch {
    // Logging must never break the UI path.
  }
}

export type { AppSettings }
