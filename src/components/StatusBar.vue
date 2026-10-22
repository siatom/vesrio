<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, Sparkles } from 'lucide-vue-next'
import { useWorkspaceStore } from '@/stores/workspace'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useSettingsStore } from '@/stores/settings'
import { countCharacters, countWords } from '@/lib/text'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const suggestions = useSuggestionsStore()

const tab = computed(() => workspace.activeTab)
const text = computed(() => tab.value?.editorText ?? '')
const words = computed(() => countWords(text.value))
const chars = computed(() => countCharacters(text.value))
const eolLabel = computed(() => {
  const eol = tab.value?.document.eol
  return eol === 'crlf' ? 'CRLF' : eol === 'mixed' ? 'Mixed EOL' : 'LF'
})
const encodingLabel = computed(() => {
  const doc = tab.value?.document
  if (!doc) return ''
  return doc.encoding === 'utf-8-bom' ? 'UTF-8 BOM' : 'UTF-8'
})
const saveLabel = computed(() => {
  switch (tab.value?.saveState) {
    case 'saved':
      return '已保存'
    case 'dirty':
      return '未保存'
    case 'saving':
      return '保存中…'
    case 'error':
      return '保存失败'
    case 'conflict':
      return '外部冲突'
    default:
      return ''
  }
})
</script>

<template>
  <footer class="statusbar" aria-label="文档状态">
    <div class="statusbar__left">
      <span v-if="tab" class="statusbar__item">{{ words.toLocaleString() }} 字</span>
      <span v-if="tab" class="statusbar__item">{{ chars.toLocaleString() }} 字符</span>
      <span v-if="tab" class="statusbar__item">行 {{ tab.cursorLine }}，列 {{ tab.cursorColumn }}</span>
      <span v-if="suggestions.generating" class="statusbar__item statusbar__ai">
        <Loader2 :size="12" class="spin" /> AI 生成中
        <button class="statusbar__cancel" @click="suggestions.cancel()">取消</button>
      </span>
    </div>
    <div class="statusbar__right">
      <span class="statusbar__item">{{ settings.reviewMode ? '审阅模式' : '写作模式' }}</span>
      <span v-if="tab" class="statusbar__item">{{ encodingLabel }} · {{ eolLabel }}</span>
      <span v-if="tab" class="statusbar__item" :class="`statusbar__save--${tab.saveState}`">
        <Sparkles v-if="tab.saveState === 'conflict'" :size="12" />
        {{ saveLabel }}
      </span>
    </div>
  </footer>
</template>
