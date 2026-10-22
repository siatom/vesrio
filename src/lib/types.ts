export type Theme = 'system' | 'light' | 'dark'
export type EditorFont = 'serif' | 'sans' | 'mono'
export type InspectorTab = 'outline' | 'agent' | 'revisions'
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

export interface AppErrorPayload {
  code: string
  message: string
  retryable?: boolean
  details?: Record<string, unknown>
}

export interface AppInfo {
  name: string
  version: string
  dataDir: string
  logPath: string
  platform: string
}

export interface DocumentWarning {
  code: string
  message: string
}

export interface DocumentView {
  id: string
  path: string
  title: string
  text: string
  encoding: string
  eol: 'lf' | 'crlf' | 'mixed'
  bom: boolean
  diskHash: string
  contentHash: string
  revision: number
  size: number
  modifiedMs: number | null
  readOnly: boolean
  written: boolean
  warnings: DocumentWarning[]
}

export interface SaveOutcome {
  document: DocumentView
  wrote: boolean
  bytesWritten: number
}

export interface ExternalChange {
  changed: boolean
  knownHash: string
  diskHash: string | null
  diskSize: number | null
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  size: number | null
  children: FileNode[]
}

export interface Project {
  id: string
  rootPath: string
  name: string
  styleProfileId: string | null
  createdAt: string
}

export interface ProjectWorkspace {
  project: Project
  tree: FileNode
}

export interface RecentEntry {
  id: string
  path: string
  title: string
  exists: boolean
  lastOpenedAt: string
}

export interface ProviderConfig {
  baseUrl: string
  model: string
  timeoutMs: number
  temperature: number
  maxTokens: number
}

export interface ProviderConfigView extends ProviderConfig {
  hasApiKey: boolean
}

export interface ProviderTestResult {
  host: string
  models: string[]
}

export interface TerminologyRule {
  term: string
  preferred: string
}

export interface StyleRules {
  audience: string
  tone: string
  terminology: TerminologyRule[]
  banned: string[]
  notes: string
}

export interface StyleProfile {
  id: string
  projectId: string
  version: number
  rules: StyleRules
  createdAt: string
}

export interface SnapshotRecord {
  id: string
  documentId: string
  contentHash: string
  source: string
  sizeBytes: number
  createdAt: string
}

export interface SnapshotFile {
  record: SnapshotRecord
  content: string
}

export interface RestoreOutcome {
  content: string
  safetySnapshotId: string
  snapshot: SnapshotRecord
}

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant' | string
  content: string
}

export interface PreparedRequest {
  requestId: string
  messages: ChatMessagePayload[]
  outboundChars: number
  readScope: string
  writeScope: string
  model: string
  providerHost: string
  baseRevision: number
}

export interface PreparedChat {
  requestId: string
  conversationId: string
  messages: ChatMessagePayload[]
  outboundChars: number
  readScope: string
  model: string
  providerHost: string
}

export interface Candidate {
  idx: number
  candidateText: string
  rationale: string
}

export type SuggestionStatus =
  | 'created'
  | 'generating'
  | 'ready'
  | 'stale'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'canceled'

export interface SuggestionView {
  id: string
  requestId: string
  documentId: string
  fromUtf16: number
  toUtf16: number
  selectedTextHash: string
  originalText: string
  candidateText: string
  rationale: string
  warnings: string[]
  status: SuggestionStatus
  selectedCandidate: number
  candidates: Candidate[]
  baseRevision: number
  snapshotId: string | null
  createdAt: string
}

export interface ApplyOutcome {
  suggestion: SuggestionView
  newText: string
  fromUtf16: number
  toUtf16: number
  snapshotId: string
  alreadyApplied: boolean
}

export interface Citation {
  fromUtf16: number
  toUtf16: number
  text: string
  textHash: string
  resolved: boolean
}

export interface MessageRecord {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | string
  content: string
  citations: Citation[]
  createdAt: string
}

export interface ConversationRecord {
  id: string
  documentId: string
  projectId: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatResult {
  message: MessageRecord
  conversationId: string
}

export interface AppSettings {
  theme: Theme
  editorFont: EditorFont
  fontSize: number
  lineHeight: number
  editorWidth: number
  focusMode: boolean
  reviewMode: boolean
  confirmBeforeSend: boolean
  autoSnapshot: boolean
  typewriterMode: boolean
  sidebarWidth: number
  inspectorWidth: number
  sidebarOpen: boolean
  outlineOpen: boolean
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  lastFolder: string
  lastDocument: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  editorFont: 'serif',
  fontSize: 17,
  lineHeight: 1.85,
  editorWidth: 720,
  focusMode: false,
  reviewMode: false,
  confirmBeforeSend: true,
  autoSnapshot: true,
  typewriterMode: false,
  sidebarWidth: 258,
  inspectorWidth: 348,
  sidebarOpen: true,
  outlineOpen: true,
  inspectorOpen: true,
  inspectorTab: 'outline',
  lastFolder: '',
  lastDocument: '',
}

export interface OutlineHeading {
  level: number
  text: string
  from: number
  line: number
}

export interface DiffSegment {
  type: 'same' | 'add' | 'remove'
  text: string
}

export interface EditorSelection {
  from: number
  to: number
  text: string
}

export interface TabState {
  document: DocumentView
  editorText: string
  editRevision: number
  dirty: boolean
  saveState: SaveState
  saveError: string
  selection: EditorSelection
  cursorLine: number
  cursorColumn: number
  docEpoch: number
  sourceMode: boolean
  externalChange: ExternalChange | null
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'warn' | 'error'
  message: string
  detail?: string
}
