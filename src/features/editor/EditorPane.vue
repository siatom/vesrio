<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  AlertTriangle,
  Code2,
  Eye,
  Sparkles,
} from 'lucide-vue-next'
import SelectionToolbar from './SelectionToolbar.vue'
import SuggestionCard from '@/features/inline-ai/SuggestionCard.vue'
import { useEditor } from './useEditor'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'

const workspace = useWorkspaceStore()
const suggestions = useSuggestionsStore()
const ui = useUiStore()

const host = ref<HTMLElement | null>(null)
useEditor(host)

const tab = computed(() => workspace.activeTab)
const empty = computed(() => (tab.value?.editorText.length ?? 0) === 0)
const warnings = computed(() => tab.value?.document.warnings ?? [])

async function toggleSource() {
  workspace.toggleSourceMode()
}

function openInlineAi() {
  suggestions.openDraftFromEditor()
}

async function reload() {
  try {
    await workspace.reloadTab()
    ui.success('已从磁盘重新载入', '本地未保存内容已提前创建快照')
  } catch (error) {
    ui.error('重新载入失败', friendlyMessage(error))
  }
}

async function keepCurrent() {
  try {
    await workspace.save(undefined, true)
    ui.success('已用当前内容覆盖磁盘文件')
  } catch (error) {
    ui.error('保存失败', friendlyMessage(error))
  }
}

async function saveAs() {
  try {
    await workspace.saveAs()
  } catch (error) {
    ui.error('另存为失败', friendlyMessage(error))
  }
}
</script>

<template>
  <section v-if="tab" class="editor-pane">
    <header class="editor-toolbar">
      <div class="editor-toolbar__doc">
        <span class="editor-toolbar__title">{{ tab.document.title }}</span>
        <span class="editor-toolbar__path" :title="tab.document.path">{{ tab.document.path }}</span>
      </div>
      <div class="editor-toolbar__actions">
        <button class="toolbar-button" :title="tab.sourceMode ? '切换到实时预览' : '切换到 Markdown 源码'" @click="toggleSource">
          <Eye v-if="tab.sourceMode" :size="14" />
          <Code2 v-else :size="14" />
          {{ tab.sourceMode ? '实时' : '源码' }}
        </button>
        <button class="toolbar-button toolbar-button--ai" title="选中文字后请求 AI 建议 (Ctrl+J)" @click="openInlineAi">
          <Sparkles :size="14" /> AI 建议
        </button>
      </div>
    </header>

    <div v-if="tab.document.readOnly" class="editor-banner editor-banner--danger">
      <AlertTriangle :size="14" />
      <span>这个文件是只读的。可用「另存为」保存副本。</span>
      <button class="btn btn--small" @click="saveAs">另存为</button>
    </div>

    <div v-if="tab.externalChange" class="editor-banner editor-banner--warn">
      <AlertTriangle :size="14" />
      <span>
        磁盘上的文件已被其它程序修改。{{ tab.dirty ? '你有未保存的修改，Vesrio 不会自动覆盖任何一方。' : '' }}
      </span>
      <div class="editor-banner__actions">
        <button class="btn btn--small" @click="reload">重新载入</button>
        <button class="btn btn--small" @click="keepCurrent">保留当前并覆盖</button>
        <button class="btn btn--ghost btn--small" @click="saveAs">另存为</button>
      </div>
    </div>

    <div v-for="warning in warnings" :key="warning.code" class="editor-banner editor-banner--info">
      <AlertTriangle :size="14" />
      <span>{{ warning.message }}</span>
    </div>

    <div class="editor-stage">
      <div ref="host" class="editor-host" />
      <div v-if="empty" class="editor-placeholder">
        开始写作，或选中一段文字后按 <kbd>Ctrl</kbd> + <kbd>J</kbd> 请求 AI 建议。
      </div>
      <SelectionToolbar />
      <SuggestionCard />
    </div>
  </section>
</template>
