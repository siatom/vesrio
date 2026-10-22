<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Camera,
  Code2,
  FilePlus2,
  FolderOpen,
  Keyboard,
  Maximize2,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Save,
  ScanEye,
  Search,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'
import { openFile, openFolder } from '@/features/files/openFile'

const ui = useUiStore()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const suggestions = useSuggestionsStore()

const query = ref('')
const activeIndex = ref(0)
const listEl = ref<HTMLElement | null>(null)

interface Command {
  id: string
  label: string
  hint?: string
  icon: typeof Search
  run: () => void | Promise<void>
}

const commands = computed<Command[]>(() => {
  const base: Command[] = [
    { id: 'open-file', label: '打开文件', hint: 'Ctrl+O', icon: FilePlus2, run: async () => { await workspace.pickAndOpenFile() } },
    { id: 'open-folder', label: '打开文件夹', hint: 'Ctrl+Shift+O', icon: FolderOpen, run: () => openFolder() },
    { id: 'new', label: '新建文稿', hint: 'Ctrl+N', icon: FilePlus2, run: async () => { await workspace.createDocument() } },
    { id: 'save', label: '保存当前文档', hint: 'Ctrl+S', icon: Save, run: async () => { await workspace.save() } },
    { id: 'save-as', label: '另存为…', hint: 'Ctrl+Shift+S', icon: Save, run: () => workspace.saveAs() },
    { id: 'snapshot', label: '创建手动快照', hint: 'Ctrl+Shift+M', icon: Camera, run: async () => { await workspace.createManualSnapshot() } },
    { id: 'ai', label: '对选区请求 AI 建议', hint: 'Ctrl+J', icon: Sparkles, run: () => suggestions.openDraftFromEditor() },
    { id: 'source', label: '切换源码 / 实时预览', icon: Code2, run: () => workspace.toggleSourceMode() },
    { id: 'focus', label: '切换专注模式', hint: 'Ctrl+Shift+F', icon: Maximize2, run: () => settings.toggleFocusMode() },
    { id: 'review', label: '切换审阅模式', hint: 'Ctrl+Shift+R', icon: ScanEye, run: () => settings.toggleReviewMode() },
    { id: 'theme', label: '切换深色 / 浅色主题', icon: settings.resolvedTheme === 'dark' ? Sun : Moon, run: () => settings.toggleTheme() },
    { id: 'sidebar', label: settings.sidebarOpen ? '收起左侧栏' : '展开左侧栏', icon: PanelLeft, run: async () => { await settings.update({ sidebarOpen: !settings.sidebarOpen }) } },
    { id: 'inspector', label: settings.inspectorOpen ? '收起右侧栏' : '展开右侧栏', icon: PanelRight, run: async () => { await settings.update({ inspectorOpen: !settings.inspectorOpen }) } },
    { id: 'agent', label: '打开 Agent 对话', icon: MessageSquare, run: async () => { await settings.update({ inspectorOpen: true, inspectorTab: 'agent' }) } },
    { id: 'settings', label: '打开设置', hint: 'Ctrl+,', icon: Settings, run: () => { ui.settingsOpen = true } },
    { id: 'shortcuts', label: '查看快捷键', hint: 'Ctrl+/', icon: Keyboard, run: () => { ui.shortcutsOpen = true } },
  ]
  for (const tab of workspace.tabs) {
    base.push({
      id: `tab-${tab.document.id}`,
      label: `切换到「${tab.document.title}」`,
      hint: tab.dirty ? '未保存' : tab.document.path,
      icon: FilePlus2,
      run: () => workspace.activate(tab.document.id),
    })
  }
  for (const recent of workspace.recent.slice(0, 5)) {
    base.push({
      id: `recent-${recent.id}`,
      label: `打开最近：${recent.title}`,
      hint: recent.path,
      icon: FolderOpen,
      run: () => openFile(recent.path),
    })
  }
  return base
})

const filtered = computed(() => {
  const value = query.value.trim().toLowerCase()
  if (!value) return commands.value
  return commands.value.filter(
    (command) =>
      command.label.toLowerCase().includes(value) ||
      (command.hint ?? '').toLowerCase().includes(value),
  )
})

watch(query, () => {
  activeIndex.value = 0
})
watch(
  () => ui.paletteOpen,
  async (open) => {
    if (open) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      listEl.value?.focus()
    }
  },
)

async function run(command: Command) {
  ui.paletteOpen = false
  try {
    await command.run()
  } catch (error) {
    ui.error('命令执行失败', friendlyMessage(error))
  }
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    ui.paletteOpen = false
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, filtered.value.length - 1)
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const command = filtered.value[activeIndex.value]
    if (command) void run(command)
  }
}

function close() {
  ui.paletteOpen = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="ui.paletteOpen" class="modal-backdrop modal-backdrop--top" @click.self="close">
        <div class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="palette__search">
            <Search :size="17" />
            <input
              v-model="query"
              class="palette__input"
              placeholder="搜索命令或文档…"
              aria-label="搜索命令"
              @keydown="keydown"
            />
            <kbd>Esc</kbd>
          </div>
          <div ref="listEl" class="palette__list" role="listbox" tabindex="-1" @keydown="keydown">
            <button
              v-for="(command, index) in filtered"
              :key="command.id"
              class="palette__item"
              :class="{ 'is-active': index === activeIndex }"
              role="option"
              :aria-selected="index === activeIndex"
              @mouseenter="activeIndex = index"
              @click="run(command)"
            >
              <component :is="command.icon" :size="15" />
              <span class="palette__label">{{ command.label }}</span>
              <span v-if="command.hint" class="palette__hint">{{ command.hint }}</span>
            </button>
            <p v-if="!filtered.length" class="palette__empty">没有匹配的命令。</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
