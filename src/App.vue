<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onAiEvent } from '@/lib/api'
import { friendlyMessage } from '@/lib/errors'
import { DEFAULT_SETTINGS, type AppErrorPayload, type SuggestionView } from '@/lib/types'
import TitleBar from '@/components/TitleBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import StatusBar from '@/components/StatusBar.vue'
import EmptyState from '@/components/EmptyState.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ConflictDialog from '@/components/ConflictDialog.vue'
import EncodingDialog from '@/components/EncodingDialog.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import EditorPane from '@/features/editor/EditorPane.vue'
import InspectorPanel from '@/features/inspector/InspectorPanel.vue'
import InlineAiDialog from '@/features/inline-ai/InlineAiDialog.vue'
import SettingsDialog from '@/features/settings/SettingsDialog.vue'
import ShortcutsDialog from '@/features/settings/ShortcutsDialog.vue'
import StyleCardDialog from '@/features/style/StyleCardDialog.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useAgentStore } from '@/stores/agent'
import { useStyleStore } from '@/stores/style'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { openFolder } from '@/features/files/openFile'

const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const suggestions = useSuggestionsStore()
const agent = useAgentStore()
const style = useStyleStore()
const ui = useUiStore()

const unlisteners: Array<() => void> = []
let pollTimer: number | undefined

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 480
const INSPECTOR_MIN = 260
const INSPECTOR_MAX = 640
const EDITOR_MIN = 360

const windowWidth = ref(typeof window === 'undefined' ? 1280 : window.innerWidth)
const sidebarVisible = computed(() => settings.sidebarOpen && !settings.focusMode)
const inspectorVisible = computed(() => settings.inspectorOpen && !settings.focusMode)

const sidebarLimit = computed(() => {
  const reserved = inspectorVisible.value ? Math.min(settings.inspectorWidth, INSPECTOR_MAX) : 0
  return Math.max(
    SIDEBAR_MIN,
    Math.min(SIDEBAR_MAX, windowWidth.value - reserved - EDITOR_MIN),
  )
})

const inspectorLimit = computed(() => {
  const reserved = sidebarVisible.value ? Math.min(settings.sidebarWidth, SIDEBAR_MAX) : 0
  return Math.max(
    INSPECTOR_MIN,
    Math.min(INSPECTOR_MAX, windowWidth.value - reserved - EDITOR_MIN),
  )
})

const sidebarWidth = computed(() =>
  Math.round(Math.min(sidebarLimit.value, Math.max(SIDEBAR_MIN, settings.sidebarWidth))),
)

const inspectorWidth = computed(() =>
  Math.round(Math.min(inspectorLimit.value, Math.max(INSPECTOR_MIN, settings.inspectorWidth))),
)

const shellStyle = computed(() => ({
  '--sidebar-width': `${sidebarWidth.value}px`,
  '--inspector-width': `${inspectorWidth.value}px`,
}))

function previewSidebarWidth(width: number) {
  settings.$patch({ sidebarWidth: width })
}

function commitSidebarWidth(width: number) {
  void settings.update({ sidebarWidth: width })
}

function resetSidebarWidth() {
  void settings.update({ sidebarWidth: DEFAULT_SETTINGS.sidebarWidth })
}

function previewInspectorWidth(width: number) {
  settings.$patch({ inspectorWidth: width })
}

function commitInspectorWidth(width: number) {
  void settings.update({ inspectorWidth: width })
}

function resetInspectorWidth() {
  void settings.update({ inspectorWidth: DEFAULT_SETTINGS.inspectorWidth })
}

function onWindowResize() {
  windowWidth.value = window.innerWidth
}

async function bootstrap() {
  await settings.load()
  settings.watchSystemTheme()
  await workspace.bootstrap()
  await style.load(workspace.project?.id ?? null)
  if (!settings.confirmBeforeSend) {
    ui.warn('发送前确认已关闭', '可在设置中重新开启，以便检查每次外发内容')
  }
}

async function registerEvents() {
  unlisteners.push(
    await onAiEvent<{ requestId: string; delta: string }>('ai:delta', (payload) => {
      suggestions.onDelta(payload.requestId, payload.delta)
    }),
    await onAiEvent<{ requestId: string; suggestion: SuggestionView }>('ai:suggestion', (payload) => {
      suggestions.onSuggestionEvent(payload.suggestion)
    }),
    await onAiEvent<{ requestId: string; error: AppErrorPayload }>('ai:error', (payload) => {
      if (suggestions.requestId !== payload.requestId) return
      suggestions.generating = false
      suggestions.requestId = null
      suggestions.error = payload.error.message
    }),
    await onAiEvent<{ requestId: string; delta: string }>('ai:chat-delta', (payload) => {
      agent.onDelta(payload.requestId, payload.delta)
    }),
    await onAiEvent<{ requestId: string }>('ai:chat-done', () => {
      // The command promise owns the final message; the event is for streaming only.
    }),
    await onAiEvent<{ requestId: string; error: AppErrorPayload }>('ai:chat-error', (payload) => {
      if (agent.requestId === payload.requestId) {
        agent.error = friendlyMessage(payload.error)
        agent.generating = false
        agent.requestId = null
        agent.streaming = ''
      }
    }),
  )
}

onMounted(async () => {
  try {
    await bootstrap()
    await registerEvents()
  } catch (error) {
    ui.error('启动失败', friendlyMessage(error))
  }
  pollTimer = window.setInterval(() => {
    void pollExternal()
  }, 15000)
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onKeydown, { capture: true })
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  for (const unlisten of unlisteners) unlisten()
  if (pollTimer) window.clearInterval(pollTimer)
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKeydown, { capture: true })
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('resize', onWindowResize)
})

async function pollExternal() {
  const changed = await workspace.pollExternal()
  if (changed.length) {
    ui.warn(`${changed.join('、')} 在磁盘上发生了变化`, '打开冲突提示后选择重新载入或保留当前内容')
  }
}

function onFocus() {
  void pollExternal()
}

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!workspace.hasDirtyTabs) return
  event.preventDefault()
  event.returnValue = ''
}

watch(
  () => workspace.activeId,
  async (id) => {
    if (suggestions.draft.open) suggestions.closeDraft()
    if (!id) return
    await Promise.all([suggestions.loadForDocument(id), agent.loadForDocument(id)])
  },
)

watch(
  () => workspace.project?.id,
  async (id) => {
    await style.load(id ?? null)
  },
)

watch(
  () => settings.reviewMode,
  async (enabled) => {
    if (enabled) {
      await settings.update({ inspectorOpen: true, inspectorTab: 'revisions' })
    }
  },
)

async function saveActive() {
  try {
    await workspace.save()
  } catch (error) {
    if (workspace.activeTab?.saveState !== 'conflict') {
      ui.error('保存失败', friendlyMessage(error))
    }
  }
}

async function saveActiveAs() {
  try {
    await workspace.saveAs()
  } catch (error) {
    ui.error('另存为失败', friendlyMessage(error))
  }
}

async function closeActiveTab() {
  if (!workspace.activeId) return
  try {
    await workspace.closeTab(workspace.activeId)
  } catch (error) {
    ui.error('关闭失败', friendlyMessage(error))
  }
}

async function manualSnapshot() {
  try {
    await workspace.createManualSnapshot()
    ui.success('已创建快照')
    await settings.update({ inspectorTab: 'revisions', inspectorOpen: true })
  } catch (error) {
    ui.error('创建快照失败', friendlyMessage(error))
  }
}

async function adjustFont(delta: number) {
  const next = Math.min(28, Math.max(12, settings.fontSize + delta))
  if (next !== settings.fontSize) await settings.update({ fontSize: next })
}

function closeTopLayer(): boolean {
  if (ui.paletteOpen) {
    ui.paletteOpen = false
    return true
  }
  if (ui.confirm || ui.choice) {
    if (ui.choice) ui.resolveChoice('cancel')
    else ui.resolveConfirm(false)
    return true
  }
  if (ui.settingsOpen) {
    ui.settingsOpen = false
    return true
  }
  if (ui.shortcutsOpen) {
    ui.shortcutsOpen = false
    return true
  }
  if (ui.styleOpen) {
    ui.styleOpen = false
    return true
  }
  if (ui.encodingPrompt) {
    ui.encodingPrompt = null
    return true
  }
  if (suggestions.draft.open) {
    suggestions.closeDraft()
    return true
  }
  if (suggestions.generating) {
    void suggestions.cancel()
    return true
  }
  if (suggestions.cardVisible) {
    suggestions.closeCard()
    return true
  }
  if (settings.focusMode) {
    void settings.update({ focusMode: false })
    return true
  }
  return false
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') {
    if (closeTopLayer()) event.preventDefault()
    return
  }
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return
  const key = event.key.toLowerCase()

  if (key === 's') {
    event.preventDefault()
    if (event.shiftKey) void saveActiveAs()
    else void saveActive()
    return
  }
  if (key === 'o') {
    event.preventDefault()
    if (event.shiftKey) void openFolder()
    else void workspace.pickAndOpenFile().catch((e) => ui.error('打开文件失败', friendlyMessage(e)))
    return
  }
  if (key === 'n') {
    event.preventDefault()
    void workspace.createDocument().catch((e) => ui.error('新建文档失败', friendlyMessage(e)))
    return
  }
  if (key === 'w') {
    event.preventDefault()
    void closeActiveTab()
    return
  }
  if (key === 'j') {
    event.preventDefault()
    suggestions.openDraftFromEditor()
    return
  }
  if (key === 'k') {
    event.preventDefault()
    ui.paletteOpen = !ui.paletteOpen
    return
  }
  if (key === 'b') {
    event.preventDefault()
    if (event.altKey) void settings.update({ inspectorOpen: !settings.inspectorOpen })
    else void settings.update({ sidebarOpen: !settings.sidebarOpen })
    return
  }
  if (event.key === ',' || key === ',') {
    event.preventDefault()
    ui.settingsOpen = true
    return
  }
  if (key === '/' || event.key === '?') {
    event.preventDefault()
    ui.shortcutsOpen = true
    return
  }
  if (key === 'f' && event.shiftKey) {
    event.preventDefault()
    void settings.toggleFocusMode()
    return
  }
  if (key === 'r' && event.shiftKey) {
    event.preventDefault()
    void settings.toggleReviewMode()
    return
  }
  if (key === 'm' && event.shiftKey) {
    event.preventDefault()
    void manualSnapshot()
    return
  }
  if (key === '=' || key === '+') {
    event.preventDefault()
    void adjustFont(1)
    return
  }
  if (key === '-') {
    event.preventDefault()
    void adjustFont(-1)
    return
  }
  if (['1', '2', '3'].includes(event.key)) {
    event.preventDefault()
    const tabs = ['outline', 'agent', 'revisions'] as const
    const selected = tabs[Number(event.key) - 1] ?? 'outline'
    void settings.update({ inspectorOpen: true, inspectorTab: selected })
    return
  }
  if (key === 'tab') {
    event.preventDefault()
    const index = workspace.tabs.findIndex((tab) => tab.document.id === workspace.activeId)
    if (workspace.tabs.length > 1) {
      const next = (index + 1) % workspace.tabs.length
      const tab = workspace.tabs[next]
      if (tab) workspace.activate(tab.document.id)
    }
  }
}
</script>

<template>
  <div
    class="app-shell"
    :class="{
      'is-focus': settings.focusMode,
      'is-review': settings.reviewMode,
      'no-sidebar': !sidebarVisible,
      'no-inspector': !inspectorVisible,
    }"
    :style="shellStyle"
  >
    <TitleBar />
    <div class="app-body">
      <Sidebar v-if="sidebarVisible" />
      <ResizeHandle
        v-if="sidebarVisible"
        side="left"
        label="调整左侧栏宽度"
        :width="sidebarWidth"
        :min="SIDEBAR_MIN"
        :max="sidebarLimit"
        @resize="previewSidebarWidth"
        @commit="commitSidebarWidth"
        @reset="resetSidebarWidth"
      />
      <div class="app-main">
        <EditorPane v-if="workspace.activeTab" />
        <EmptyState v-else />
      </div>
      <ResizeHandle
        v-if="inspectorVisible"
        side="right"
        label="调整右侧栏宽度"
        :width="inspectorWidth"
        :min="INSPECTOR_MIN"
        :max="inspectorLimit"
        @resize="previewInspectorWidth"
        @commit="commitInspectorWidth"
        @reset="resetInspectorWidth"
      />
      <InspectorPanel v-if="inspectorVisible" />
    </div>
    <StatusBar />

    <ToastHost />
    <ConfirmDialog />
    <ConflictDialog />
    <EncodingDialog />
    <CommandPalette />
    <InlineAiDialog />
    <SettingsDialog v-if="ui.settingsOpen" />
    <ShortcutsDialog v-if="ui.shortcutsOpen" />
    <StyleCardDialog v-if="ui.styleOpen" />
  </div>
</template>
