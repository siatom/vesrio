<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from 'lucide-vue-next'
import { diffText } from '@/lib/diff'
import { getEditor } from '@/features/editor/editorRegistry'
import { useSuggestionsStore } from '@/stores/suggestions'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const suggestions = useSuggestionsStore()

const cardEl = ref<HTMLElement | null>(null)
const position = ref({ left: 16, top: 16, width: 520 })
const selectedIndex = ref(0)

const tab = computed(() => workspace.activeTab)
const current = computed(() => suggestions.activeSuggestion)
const generating = computed(
  () => suggestions.generating && suggestions.requestDocumentId === tab.value?.document.id,
)
const visible = computed(() => Boolean(tab.value) && suggestions.cardVisible)
const candidates = computed(() => current.value?.candidates ?? [])
const candidate = computed(() => candidates.value[selectedIndex.value] ?? candidates.value[0] ?? null)
const segments = computed(() =>
  current.value
    ? diffText(current.value.originalText, candidate.value?.candidateText ?? current.value.candidateText)
    : [],
)
const streamingText = computed(() =>
  (tab.value ? suggestions.streamingByDocument[tab.value.document.id] ?? '' : '').replaceAll(
    '<<<VESRIO_CANDIDATE>>>',
    '\n\n— 备选 —\n\n',
  ),
)
const stale = computed(() => current.value?.status === 'stale')
const canAccept = computed(
  () => current.value?.status === 'ready' && Boolean(candidate.value),
)
const failed = computed(
  () => current.value?.status === 'failed' || current.value?.status === 'canceled',
)

watch(
  () => current.value?.id,
  () => {
    const index = current.value?.selectedCandidate ?? 0
    selectedIndex.value = Math.min(Math.max(index, 0), Math.max(candidates.value.length - 1, 0))
  },
)

function updatePosition() {
  const activeTab = tab.value
  const editor = getEditor(activeTab?.document.id)
  if (!activeTab || !editor) return
  const from = current.value
    ? current.value.fromUtf16
    : suggestions.anchorByDocument[activeTab.document.id]?.from
  if (from == null) return
  const coords = editor.coordsAtPos(from)
  if (!coords) return
  const width = Math.min(540, window.innerWidth - 32)
  const height = cardEl.value?.offsetHeight ?? 360
  let left = Math.min(Math.max(16, coords.left - 24), window.innerWidth - width - 16)
  let top = coords.bottom + 12
  if (top + height > window.innerHeight - 16) {
    top = Math.max(16, coords.top - height - 12)
  }
  position.value = { left, top, width }
}

watch(
  [visible, () => current.value?.id, () => current.value?.status, streamingText, selectedIndex],
  async () => {
    await nextTick()
    updatePosition()
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  updatePosition()
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

function accept() {
  if (!canAccept.value) return
  void suggestions.accept(selectedIndex.value)
}

function reject() {
  void suggestions.reject()
}

function cancel() {
  void suggestions.cancel()
}

function close() {
  suggestions.closeCard()
}

function regenerate() {
  void suggestions.regenerate()
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    if (generating.value) cancel()
    else close()
    return
  }
  if (generating.value) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    accept()
    return
  }
  if (event.key === 'ArrowLeft' && selectedIndex.value > 0) {
    event.preventDefault()
    selectedIndex.value -= 1
  }
  if (event.key === 'ArrowRight' && selectedIndex.value < candidates.value.length - 1) {
    event.preventDefault()
    selectedIndex.value += 1
  }
  if (event.altKey && event.key === 'Backspace') {
    event.preventDefault()
    reject()
  }
}
</script>

<template>
  <Transition name="pop">
    <aside
      v-if="visible"
      ref="cardEl"
      class="suggestion-card"
      :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }"
      role="dialog"
      aria-label="AI 建议"
      tabindex="0"
      @keydown="keydown"
    >
      <header class="suggestion-card__header">
        <div class="suggestion-card__title">
          <Sparkles :size="15" />
          <span>AI 建议</span>
          <span v-if="stale" class="pill pill--warn">已过期</span>
          <span v-else-if="current?.status === 'ready'" class="pill">未写入</span>
        </div>
        <button class="icon-button" aria-label="关闭建议卡" @click="close"><X :size="15" /></button>
      </header>

      <div v-if="generating" class="suggestion-streaming">
        <div v-if="!streamingText" class="suggestion-streaming__hint">
          <Loader2 :size="15" class="spin" /> 正在请求模型…
        </div>
        <pre v-else class="suggestion-streaming__text">{{ streamingText }}</pre>
        <footer class="suggestion-streaming__footer">
          <span>流式预览，尚未写入正文</span>
          <button class="btn btn--small btn--danger" @click="cancel">
            <Square :size="12" /> 取消
          </button>
        </footer>
      </div>

      <div v-else-if="current && failed" class="suggestion-failed">
        <AlertTriangle :size="18" />
        <p>{{ suggestions.error || '本次生成未成功，正文没有发生任何变化。' }}</p>
        <div class="suggestion-failed__actions">
          <button class="btn btn--small" @click="regenerate">重新尝试</button>
          <button class="btn btn--ghost btn--small" @click="close">关闭</button>
        </div>
      </div>

      <template v-else-if="current">
        <div v-if="stale" class="suggestion-stale">
          <AlertTriangle :size="15" />
          <span>原文在生成期间发生了变化，旧建议不能直接应用。</span>
        </div>

        <div v-if="current.warnings.length" class="suggestion-warnings">
          <div v-for="warning in current.warnings" :key="warning" class="suggestion-warning">
            <AlertTriangle :size="12" /> {{ warning }}
          </div>
        </div>

        <div v-if="candidates.length > 1" class="candidate-tabs" role="tablist" aria-label="候选版本">
          <button
            v-for="(item, index) in candidates"
            :key="item.idx"
            class="candidate-tab"
            :class="{ 'is-active': index === selectedIndex }"
            role="tab"
            :aria-selected="index === selectedIndex"
            @click="selectedIndex = index"
          >
            候选 {{ index + 1 }}
          </button>
        </div>

        <div class="suggestion-diff" aria-label="建议差异">
          <div class="suggestion-diff__label">差异预览</div>
          <div class="suggestion-diff__text">
            <span
              v-for="(segment, index) in segments"
              :key="index"
              :class="{
                'diff-add': segment.type === 'add',
                'diff-remove': segment.type === 'remove',
                'diff-same': segment.type === 'same',
              }"
            >{{ segment.text }}</span>
          </div>
        </div>

        <details class="suggestion-original">
          <summary>查看原文</summary>
          <pre>{{ current.originalText }}</pre>
        </details>

        <p class="suggestion-rationale">{{ current.rationale }}</p>

        <footer class="suggestion-card__footer">
          <button class="btn btn--ghost btn--small" :disabled="stale" @click="reject">
            拒绝
          </button>
          <button class="btn btn--small" @click="regenerate">
            <RefreshCw :size="12" /> 重新生成
          </button>
          <button class="btn btn--primary btn--small" :disabled="!canAccept" @click="accept">
            <Check :size="13" /> 接受
          </button>
        </footer>
        <p class="suggestion-hint">
          焦点在此卡片时：<kbd>Enter</kbd> 接受 · <kbd>←</kbd><kbd>→</kbd> 切换候选 ·
          <kbd>Esc</kbd> 关闭
        </p>
      </template>
    </aside>
  </Transition>
</template>
