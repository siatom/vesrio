<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Loader2, Send, Sparkles, Wand2, X } from 'lucide-vue-next'
import OutboundPreview from '@/components/OutboundPreview.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSuggestionsStore } from '@/stores/suggestions'

const suggestions = useSuggestionsStore()
const settings = useSettingsStore()
const textarea = ref<HTMLTextAreaElement | null>(null)

const draft = computed(() => suggestions.draft)
const prepared = computed(() => draft.value.prepared)
const selectionPreview = computed(() => {
  const text = draft.value.selection.text
  return text.length > 320 ? `${text.slice(0, 320)}…` : text
})

const presets = [
  { label: '精简', intent: 'shorten', instruction: '精简表达，保留原意与技术事实。' },
  { label: '润色', intent: 'polish', instruction: '润色文字，让表达更自然、准确，保留作者语气。' },
  { label: '改写', intent: 'rewrite', instruction: '改写这段文字，使逻辑更清晰，但不要引入新事实。' },
]

onMounted(() => {
  textarea.value?.focus()
})

function setPreset(preset: (typeof presets)[number]) {
  suggestions.setDraft({
    intent: preset.intent,
    instruction: preset.instruction,
    stage: 'compose',
    prepared: null,
    error: '',
  })
  textarea.value?.focus()
}

async function start() {
  if (draft.value.stage === 'preview') {
    await send()
    return
  }
  const preparedRequest = await suggestions.prepare()
  if (!preparedRequest) return
  if (!settings.confirmBeforeSend) {
    await suggestions.send()
  }
}

async function send() {
  await suggestions.send()
}

function back() {
  suggestions.setDraft({ stage: 'compose', prepared: null })
}

function close() {
  if (suggestions.draft.preparing || suggestions.draft.stage === 'sending') return
  suggestions.closeDraft()
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void start()
  }
}

const scopeOptions = [
  { value: 'selection', label: '仅选区', hint: '默认，最保守' },
  { value: 'selection_with_paragraph_context', label: '选区 + 段落', hint: '给模型更多语境' },
  { value: 'document', label: '全文', hint: '仅在你明确授权时' },
] as const
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="draft.open" class="modal-backdrop" @click.self="close">
        <div class="modal modal--wide" role="dialog" aria-modal="true" aria-label="行内 AI" @keydown="keydown">
          <header class="modal__header">
            <div class="modal__title">
              <Sparkles :size="17" />
              <h2>行内 AI 建议</h2>
              <span class="pill">仅生成候选</span>
            </div>
            <button class="icon-button" aria-label="关闭" @click="close"><X :size="18" /></button>
          </header>

          <div class="modal__body">
            <blockquote class="inline-selection">
              <div class="inline-selection__label">已选内容</div>
              <p>{{ selectionPreview }}</p>
            </blockquote>

            <template v-if="draft.stage === 'preview' && prepared">
              <OutboundPreview
                :messages="prepared.messages"
                :outbound-chars="prepared.outboundChars"
                :model="prepared.model"
                :provider-host="prepared.providerHost"
                :read-scope="prepared.readScope"
              />
            </template>

            <template v-else>
              <div class="inline-grid">
                <label class="field">
                  <span class="field__label">修改指令</span>
                  <textarea
                    ref="textarea"
                    :value="draft.instruction"
                    rows="5"
                    class="textarea"
                    placeholder="例如：精简但不改变技术含义；保留原句节奏；把口语化表达改成规范书面语。"
                    :disabled="draft.preparing"
                    @input="suggestions.setDraft({ instruction: ($event.target as HTMLTextAreaElement).value, stage: 'compose', error: '' })"
                  />
                </label>
                <div class="inline-presets">
                  <span class="field__label">快捷指令</span>
                  <button
                    v-for="preset in presets"
                    :key="preset.intent"
                    class="btn btn--ghost btn--small"
                    @click="setPreset(preset)"
                  >
                    <Wand2 :size="12" /> {{ preset.label }}
                  </button>
                </div>
              </div>

              <div class="inline-options">
                <div class="field">
                  <span class="field__label">读取范围</span>
                  <div class="segmented" role="group" aria-label="读取范围">
                    <button
                      v-for="option in scopeOptions"
                      :key="option.value"
                      class="segment"
                      :class="{ 'is-active': draft.scope === option.value }"
                      :title="option.hint"
                      @click="suggestions.setDraft({ scope: option.value, stage: 'compose' })"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </div>
                <div class="field">
                  <span class="field__label">候选数量</span>
                  <div class="segmented" role="group" aria-label="候选数量">
                    <button
                      v-for="count in [1, 2, 3]"
                      :key="count"
                      class="segment"
                      :class="{ 'is-active': draft.count === count }"
                      @click="suggestions.setDraft({ count })"
                    >
                      {{ count }}
                    </button>
                  </div>
                </div>
              </div>

              <p class="privacy-note">
                写入范围始终只有当前选区。模型没有文件写入权限，只有你点击「接受」才会产生一次可撤销的编辑。
              </p>
            </template>

            <div v-if="draft.error" class="inline-error">{{ draft.error }}</div>
          </div>

          <footer class="modal__footer">
            <span class="modal__footer-hint">
              {{ settings.confirmBeforeSend ? '发送前可检查完整外发内容' : '已关闭发送前确认' }}
            </span>
            <div class="modal__footer-actions">
              <button v-if="draft.stage === 'preview'" class="btn btn--ghost" @click="back">返回修改</button>
              <button v-else class="btn btn--ghost" @click="close">取消</button>
              <button
                class="btn btn--primary"
                :disabled="draft.preparing"
                @click="start"
              >
                <Loader2 v-if="draft.preparing" :size="14" class="spin" />
                <Send v-else :size="14" />
                {{ draft.stage === 'preview' ? '发送给模型' : '生成建议' }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
