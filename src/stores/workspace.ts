import { defineStore } from 'pinia'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { api, hasBackend, isTauri } from '@/lib/api'
import { friendlyMessage, normalizeError } from '@/lib/errors'
import { basename } from '@/lib/text'
import type {
  DocumentView,
  EditorSelection,
  ExternalChange,
  FileNode,
  Project,
  RecentEntry,
  TabState,
} from '@/lib/types'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'

function toTab(view: DocumentView): TabState {
  return {
    document: view,
    editorText: view.text,
    editRevision: 1,
    dirty: false,
    saveState: 'saved',
    saveError: '',
    selection: { from: 0, to: 0, text: '' },
    cursorLine: 1,
    cursorColumn: 1,
    docEpoch: 0,
    sourceMode: false,
    externalChange: null,
  }
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    tabs: [] as TabState[],
    activeId: null as string | null,
    project: null as Project | null,
    tree: null as FileNode | null,
    recent: [] as RecentEntry[],
    snapshotRevision: 0,
    loading: false,
    bootstrapped: false,
  }),
  getters: {
    activeTab(state): TabState | null {
      return state.tabs.find((tab) => tab.document.id === state.activeId) ?? null
    },
    activeDocument(): DocumentView | null {
      return this.activeTab?.document ?? null
    },
    hasDirtyTabs(state): boolean {
      return state.tabs.some((tab) => tab.dirty)
    },
  },
  actions: {
    async bootstrap() {
      if (this.bootstrapped) return
      this.bootstrapped = true
      if (!hasBackend()) return
      try {
        this.recent = await api.listRecentDocuments()
      } catch {
        this.recent = []
      }
      const settings = useSettingsStore()
      if (settings.lastFolder) {
        try {
          await this.loadProject(settings.lastFolder)
        } catch {
          // Folder may have moved; stay in the empty workspace.
        }
      }
      if (settings.lastDocument && this.recent.some((item) => item.path === settings.lastDocument && item.exists)) {
        try {
          await this.openFilePath(settings.lastDocument)
        } catch {
          // Missing or unreadable; the recent list still offers it.
        }
      }
    },
    async refreshRecent() {
      if (!hasBackend()) return
      try {
        this.recent = await api.listRecentDocuments()
      } catch {
        // non-critical
      }
    },
    async pickFolder() {
      if (!isTauri()) return null
      const selected = await openDialog({ directory: true, multiple: false, title: '打开文件夹' })
      if (typeof selected !== 'string') return null
      await this.loadProject(selected)
      return selected
    },
    async loadProject(path: string) {
      this.loading = true
      try {
        const workspace = await api.openProject(path)
        this.project = workspace.project
        this.tree = workspace.tree
        const settings = useSettingsStore()
        await settings.update({ lastFolder: path })
      } finally {
        this.loading = false
      }
    },
    async refreshTree() {
      if (!this.project) return
      try {
        this.tree = await api.scanFolder(this.project.rootPath)
      } catch {
        // keep the previous tree
      }
    },
    async pickAndOpenFile() {
      if (!isTauri()) return null
      const selected = await openDialog({
        multiple: false,
        title: '打开 Markdown 文件',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] }],
      })
      if (typeof selected !== 'string') return null
      await this.openFilePath(selected)
      return selected
    },
    async openFilePath(path: string, convertEncoding?: string) {
      if (!hasBackend()) return null
      const view = await api.openDocument(path, this.project?.id ?? null, convertEncoding ?? null)
      this.addTab(view)
      const settings = useSettingsStore()
      await settings.update({ lastDocument: view.path })
      await this.refreshRecent()
      const duplicate = this.tabs.find((tab) => tab.document.id === view.id)
      if (duplicate) duplicate.document = view
      return view
    },
    addTab(view: DocumentView) {
      const existing = this.tabs.find((tab) => tab.document.id === view.id)
      if (existing) {
        existing.document = view
        this.activeId = view.id
        return existing
      }
      const tab = toTab(view)
      this.tabs.push(tab)
      this.activeId = view.id
      return tab
    },
    activate(id: string) {
      this.activeId = id
    },
    async closeTab(id: string) {
      const tab = this.tabs.find((item) => item.document.id === id)
      if (!tab) return false
      if (tab.dirty) {
        const ui = useUiStore()
        const choice = await ui.askChoice({
          title: `关闭「${tab.document.title}」？`,
          message: '这篇文档有尚未保存的修改。保存后关闭，还是放弃这些修改？',
          primary: '保存并关闭',
          secondary: '放弃修改',
          danger: true,
        })
        if (choice === 'cancel') return false
        if (choice === 'primary') {
          try {
            await this.save(id)
          } catch (error) {
            ui.error('保存失败，已取消关闭', friendlyMessage(error))
            return false
          }
        }
      }
      try {
        await api.closeDocument(id)
      } catch {
        // The tab can still close locally if the backend already dropped it.
      }
      this.tabs = this.tabs.filter((item) => item.document.id !== id)
      if (this.activeId === id) {
        this.activeId = this.tabs[this.tabs.length - 1]?.document.id ?? null
      }
      return true
    },
    updateText(id: string, text: string) {
      const tab = this.tabs.find((item) => item.document.id === id)
      if (!tab) return
      tab.editorText = text
      tab.editRevision += 1
      tab.dirty = true
      if (tab.saveState !== 'saving' && tab.saveState !== 'conflict') {
        tab.saveState = 'dirty'
      }
    },
    updateSelection(id: string, selection: EditorSelection) {
      const tab = this.tabs.find((item) => item.document.id === id)
      if (tab) tab.selection = selection
    },
    updateCursor(id: string, line: number, column: number) {
      const tab = this.tabs.find((item) => item.document.id === id)
      if (tab) {
        tab.cursorLine = line
        tab.cursorColumn = column
      }
    },
    toggleSourceMode(id?: string) {
      const tab = this.tabs.find((item) => item.document.id === (id ?? this.activeId))
      if (tab) tab.sourceMode = !tab.sourceMode
    },
    async save(id?: string, force = false) {
      const tab = this.tabs.find((item) => item.document.id === (id ?? this.activeId))
      if (!tab) return null
      if (tab.document.readOnly) throw { code: 'permission_denied', message: '文件为只读' }
      tab.saveState = 'saving'
      tab.saveError = ''
      try {
        const outcome = await api.saveDocument(
          tab.document.id,
          tab.editorText,
          tab.document.diskHash,
          force,
        )
        tab.document = outcome.document
        tab.dirty = false
        tab.saveState = 'saved'
        tab.externalChange = null
        const settings = useSettingsStore()
        await settings.update({ lastDocument: outcome.document.path })
        await this.refreshRecent()
        return outcome
      } catch (error) {
        const normalized = normalizeError(error)
        tab.saveError = friendlyMessage(error)
        tab.saveState = normalized.code === 'external_conflict' ? 'conflict' : 'error'
        if (normalized.code === 'external_conflict') {
          tab.externalChange = {
            changed: true,
            knownHash: tab.document.diskHash,
            diskHash:
              typeof normalized.details?.diskHash === 'string'
                ? normalized.details.diskHash
                : null,
            diskSize: null,
          }
        }
        throw error
      }
    },
    async saveAs(id?: string) {
      const tab = this.tabs.find((item) => item.document.id === (id ?? this.activeId))
      if (!tab) return null
      const target = await saveDialog({
        title: '另存为',
        defaultPath: tab.document.path,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (typeof target !== 'string') return null
      const outcome = await api.saveDocumentAs(tab.document.id, target, tab.editorText)
      tab.document = outcome.document
      tab.dirty = false
      tab.saveState = 'saved'
      tab.externalChange = null
      await this.refreshRecent()
      return outcome
    },
    async createDocument() {
      if (!isTauri()) return null
      const settings = useSettingsStore()
      const base = settings.lastFolder ? `${settings.lastFolder}\\未命名.md` : '未命名.md'
      const target = await saveDialog({
        title: '新建 Markdown 文稿',
        defaultPath: base,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (typeof target !== 'string') return null
      const view = await api.createDocument(target)
      this.addTab(view)
      await settings.update({ lastDocument: view.path })
      await this.refreshRecent()
      await this.refreshTree()
      return view
    },
    async checkExternal(id?: string): Promise<ExternalChange | null> {
      const tab = this.tabs.find((item) => item.document.id === (id ?? this.activeId))
      if (!tab) return null
      try {
        const change = await api.checkExternalChange(tab.document.id)
        tab.externalChange = change.changed ? change : null
        return change
      } catch {
        return null
      }
    },
    async pollExternal(): Promise<string[]> {
      const changed: string[] = []
      for (const tab of this.tabs) {
        try {
          const change = await api.checkExternalChange(tab.document.id)
          if (change.changed) {
            tab.externalChange = change
            if (tab.dirty) changed.push(tab.document.title)
          } else {
            tab.externalChange = null
          }
        } catch {
          // ignore transient polling errors
        }
      }
      return changed
    },
    async reloadTab(id?: string) {
      const tab = this.tabs.find((item) => item.document.id === (id ?? this.activeId))
      if (!tab) return null
      const settings = useSettingsStore()
      if (tab.dirty && settings.autoSnapshot) {
        try {
          await api.createSnapshot(tab.document.id, tab.editorText, 'conflict')
        } catch {
          // A failed safety snapshot must not block an explicit reload.
        }
      }
      const view = await api.reloadDocument(tab.document.id)
      tab.document = view
      tab.editorText = view.text
      tab.dirty = false
      tab.saveState = 'saved'
      tab.saveError = ''
      tab.externalChange = null
      tab.docEpoch += 1
      tab.editRevision += 1
      return view
    },
    async restoreSnapshot(snapshotId: string) {
      const tab = this.activeTab
      if (!tab) return null
      const outcome = await api.restoreSnapshot(snapshotId, tab.editorText)
      tab.editorText = outcome.content
      tab.docEpoch += 1
      tab.dirty = true
      tab.saveState = 'dirty'
      tab.editRevision += 1
      this.snapshotRevision += 1
      return outcome
    },
    async createManualSnapshot() {
      const tab = this.activeTab
      if (!tab) return null
      const record = await api.createSnapshot(tab.document.id, tab.editorText, 'manual')
      this.snapshotRevision += 1
      return record
    },
    titleFor(id: string): string {
      const tab = this.tabs.find((item) => item.document.id === id)
      return tab ? tab.document.title || basename(tab.document.path) : ''
    },
  },
})
