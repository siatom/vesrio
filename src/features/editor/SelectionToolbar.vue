<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useWorkspaceStore } from '@/stores/workspace'
import { getEditor } from '@/features/editor/editorRegistry'

const workspace = useWorkspaceStore()
const suggestions = useSuggestionsStore()

const visible = computed(() => {
  const selection = workspace.activeTab?.selection
  return Boolean(
    selection &&
      selection.text.trim() &&
      !suggestions.draft.open &&
      !suggestions.generating &&
      !workspace.activeTab?.sourceMode,
  )
})

const position = ref({ left: 0, top: 0 })
const editor = computed(() => getEditor(workspace.activeTab?.document.id))

function updatePosition() {
  const selection = workspace.activeTab?.selection
  if (!selection || !editor.value) return
  const coords = editor.value.coordsAtPos(selection.from)
  if (!coords) return
  const width = 330
  const left = Math.min(Math.max(12, coords.left), window.innerWidth - width - 12)
  let top = coords.top - 44
  if (top < 12) top = coords.bottom + 10
  position.value = { left, top }
}

watch([visible, () => workspace.activeTab?.selection?.from], () => updatePosition(), {
  flush: 'post',
})

onMounted(() => {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  updatePosition()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

function act(instruction: string, intent: string) {
  const selection = workspace.activeTab?.selection
  if (!selection) return
  suggestions.openDraft(selection, instruction, intent)
}
</script>

<template>
  <Transition name="pop">
    <div
      v-if="visible"
      class="selection-toolbar"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      role="toolbar"
      aria-label="AI 文字操作"
      @mousedown.prevent
    >
      <button class="selection-toolbar__primary" @click="act('', 'shorten')">
        <Sparkles :size="13" /> 精简
      </button>
      <button @click="act('', 'polish')">润色</button>
      <button @click="act('', 'rewrite')">改写</button>
      <button @click="act('', 'custom')">自定义…</button>
    </div>
  </Transition>
</template>
