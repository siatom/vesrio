<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { activeHeadingIndex, parseOutline } from '@/lib/outline'
import type { OutlineHeading } from '@/lib/types'
import { getEditor } from '@/features/editor/editorRegistry'

const workspace = useWorkspaceStore()
const outline = ref<OutlineHeading[]>([])
let timer: number | undefined

function schedule(text: string) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    outline.value = parseOutline(text)
  }, 120)
}

watch(
  () => workspace.activeTab?.editorText ?? '',
  (text) => schedule(text),
  { immediate: true },
)

onBeforeUnmount(() => window.clearTimeout(timer))

const activeIndex = computed(() =>
  activeHeadingIndex(outline.value, workspace.activeTab?.cursorLine ?? 1),
)

function jump(heading: OutlineHeading) {
  const tab = workspace.activeTab
  if (!tab) return
  const editor = getEditor(tab.document.id)
  if (!editor) return
  editor.selectRange(heading.from, heading.from)
  editor.scrollToPos(heading.from)
  editor.focus()
}
</script>

<template>
  <div class="outline-panel">
    <div class="panel-heading">
      <span>文档大纲</span>
      <span class="count">{{ outline.length }}</span>
    </div>
    <nav v-if="outline.length" class="outline-list" aria-label="文档大纲">
      <button
        v-for="(heading, index) in outline"
        :key="`${heading.from}-${heading.text}`"
        class="outline-item"
        :class="{ 'is-active': index === activeIndex }"
        :style="{ paddingLeft: `${10 + (heading.level - 1) * 14}px` }"
        :title="heading.text"
        @click="jump(heading)"
      >
        <span class="outline-item__mark">{{ 'H' + heading.level }}</span>
        <span class="outline-item__text">{{ heading.text }}</span>
      </button>
    </nav>
    <p v-else class="panel-empty">
      用 <code>#</code> 或 <code>##</code> 写标题，大纲会在这里实时出现。
    </p>
  </div>
</template>
