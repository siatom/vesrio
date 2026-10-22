<script setup lang="ts">
import { computed } from 'vue'
import {
  FilePlus2,
  History,
  Maximize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Save,
  ScanEye,
  Settings,
  Sun,
  X,
} from 'lucide-vue-next'
import AppLogo from './AppLogo.vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const ui = useUiStore()

const activeTab = computed(() => workspace.activeTab)
const saveLabel = computed(() => {
  const state = activeTab.value?.saveState
  if (!state) return ''
  return {
    saved: '已保存',
    dirty: '未保存',
    saving: '保存中…',
    error: '保存失败',
    conflict: '外部冲突',
  }[state]
})

async function newDocument() {
  try {
    await workspace.createDocument()
  } catch (error) {
    ui.error('新建文档失败', friendlyMessage(error))
  }
}

async function save() {
  try {
    await workspace.save()
  } catch (error) {
    if (activeTab.value?.saveState !== 'conflict') {
      ui.error('保存失败', friendlyMessage(error))
    }
  }
}

async function manualSnapshot() {
  try {
    const snapshot = await workspace.createManualSnapshot()
    if (snapshot) {
      ui.success('已创建快照')
      await settings.update({ inspectorTab: 'revisions', inspectorOpen: true })
    }
  } catch (error) {
    ui.error('创建快照失败', friendlyMessage(error))
  }
}

async function closeTab(id: string) {
  try {
    await workspace.closeTab(id)
  } catch (error) {
    ui.error('关闭失败', friendlyMessage(error))
  }
}
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <div class="titlebar__brand" data-tauri-drag-region>
      <AppLogo :size="24" />
      <span class="titlebar__name">文屿</span>
    </div>

    <div v-if="!settings.focusMode" class="titlebar__view">
      <button
        class="icon-button"
        :aria-pressed="settings.sidebarOpen"
        :aria-label="settings.sidebarOpen ? '收起左侧栏' : '展开左侧栏'"
        :title="settings.sidebarOpen ? '收起左侧栏 (Ctrl+B)' : '展开左侧栏 (Ctrl+B)'"
        @click="settings.update({ sidebarOpen: !settings.sidebarOpen })"
      >
        <PanelLeftClose v-if="settings.sidebarOpen" :size="16" />
        <PanelLeftOpen v-else :size="16" />
      </button>
    </div>

    <div class="titlebar__tabs" role="tablist" aria-label="打开的文档">
      <button
        v-for="tab in workspace.tabs"
        :key="tab.document.id"
        class="tab"
        :class="{ 'tab--active': tab.document.id === workspace.activeId }"
        role="tab"
        :aria-selected="tab.document.id === workspace.activeId"
        :title="tab.document.path"
        @click="workspace.activate(tab.document.id)"
        @auxclick.middle.prevent="closeTab(tab.document.id)"
      >
        <span v-if="tab.dirty" class="tab__dirty" aria-label="有未保存修改" />
        <span class="tab__title">{{ tab.document.title || '未命名' }}</span>
        <span
          class="tab__close"
          role="button"
          tabindex="0"
          aria-label="关闭标签"
          @click.stop="closeTab(tab.document.id)"
          @keydown.enter.stop="closeTab(tab.document.id)"
        >
          <X :size="13" />
        </span>
      </button>
      <button class="icon-button titlebar__new" aria-label="新建文稿" title="新建文稿 (Ctrl+N)" @click="newDocument">
        <FilePlus2 :size="16" />
      </button>
    </div>

    <div class="titlebar__actions">
      <span v-if="saveLabel" class="save-state" :class="`save-state--${activeTab?.saveState}`">
        <span class="save-state__dot" />
        {{ saveLabel }}
      </span>
      <button
        class="icon-button"
        :disabled="!activeTab"
        aria-label="保存"
        title="保存 (Ctrl+S)"
        @click="save"
      >
        <Save :size="16" />
      </button>
      <button
        class="icon-button"
        :disabled="!activeTab"
        aria-label="创建快照"
        title="创建快照 (Ctrl+Shift+M)"
        @click="manualSnapshot"
      >
        <History :size="16" />
      </button>
      <button
        class="icon-button"
        :class="{ 'is-active': settings.reviewMode }"
        aria-label="切换审阅模式"
        title="审阅模式 (Ctrl+Shift+R)"
        @click="settings.toggleReviewMode()"
      >
        <ScanEye :size="16" />
      </button>
      <button
        class="icon-button"
        :class="{ 'is-active': settings.focusMode }"
        aria-label="切换专注模式"
        title="专注模式 (Ctrl+Shift+F)"
        @click="settings.toggleFocusMode()"
      >
        <Maximize2 :size="16" />
      </button>
      <button
        class="icon-button"
        aria-label="切换主题"
        :title="settings.resolvedTheme === 'dark' ? '切换到浅色' : '切换到深色'"
        @click="settings.toggleTheme()"
      >
        <Sun v-if="settings.resolvedTheme === 'dark'" :size="16" />
        <Moon v-else :size="16" />
      </button>
      <button class="icon-button" aria-label="设置" title="设置 (Ctrl+,)" @click="ui.settingsOpen = true">
        <Settings :size="16" />
      </button>
      <div v-if="!settings.focusMode" class="titlebar__view titlebar__view--end">
        <button
          class="icon-button"
          :aria-pressed="settings.inspectorOpen"
          :aria-label="settings.inspectorOpen ? '收起右侧栏' : '展开右侧栏'"
          :title="settings.inspectorOpen ? '收起右侧栏 (Ctrl+Alt+B)' : '展开右侧栏 (Ctrl+Alt+B)'"
          @click="settings.update({ inspectorOpen: !settings.inspectorOpen })"
        >
          <PanelRightClose v-if="settings.inspectorOpen" :size="16" />
          <PanelRightOpen v-else :size="16" />
        </button>
      </div>
    </div>
  </header>
</template>
