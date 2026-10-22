<script setup lang="ts">
import { ListTree, MessageSquare, PanelRightClose, Sparkles, History } from 'lucide-vue-next'
import OutlinePanel from './OutlinePanel.vue'
import AgentPanel from '@/features/agent/AgentPanel.vue'
import RevisionsPanel from './RevisionsPanel.vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import type { InspectorTab } from '@/lib/types'

const settings = useSettingsStore()
const ui = useUiStore()

const tabs: { id: InspectorTab; label: string; icon: typeof ListTree }[] = [
  { id: 'outline', label: '大纲', icon: ListTree },
  { id: 'agent', label: 'Agent', icon: MessageSquare },
  { id: 'revisions', label: '修订', icon: History },
]

async function select(id: InspectorTab) {
  await settings.update({ inspectorTab: id })
}
</script>

<template>
  <aside class="inspector" aria-label="大纲、Agent 与修订">
    <header class="inspector__header">
      <div class="inspector__tabs" role="tablist" aria-label="右侧面板">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="inspector__tab"
          :class="{ 'is-active': settings.inspectorTab === tab.id }"
          role="tab"
          :aria-selected="settings.inspectorTab === tab.id"
          @click="select(tab.id)"
        >
          <component :is="tab.icon" :size="14" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
      <button
        class="icon-button"
        title="收起右侧面板"
        aria-label="收起右侧面板"
        @click="settings.update({ inspectorOpen: false })"
      >
        <PanelRightClose :size="15" />
      </button>
    </header>
    <div class="inspector__body">
      <OutlinePanel v-show="settings.inspectorTab === 'outline'" />
      <AgentPanel v-show="settings.inspectorTab === 'agent'" />
      <RevisionsPanel v-show="settings.inspectorTab === 'revisions'" />
    </div>
    <footer class="inspector__footer">
      <button class="btn btn--ghost btn--small" @click="ui.styleOpen = true">
        <Sparkles :size="13" /> 项目风格卡
      </button>
    </footer>
  </aside>
</template>
