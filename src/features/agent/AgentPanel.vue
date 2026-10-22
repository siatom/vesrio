<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Loader2, Send, Square, Sparkles, X } from 'lucide-vue-next'
import ChatMessage from './ChatMessage.vue'
import OutboundPreview from '@/components/OutboundPreview.vue'
import { useAgentStore } from '@/stores/agent'
import { friendlyMessage } from '@/lib/errors'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'

const agent = useAgentStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()
const settings = useSettingsStore()

const scroller = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

const activeDocumentId = computed(() => workspace.activeDocument?.id ?? null)
const canSend = computed(
  () =>
    agent.draft.question.trim().length > 0 &&
    !agent.generating &&
    !agent.draft.preparing &&
    agent.draft.stage !== 'sending',
)
const preview = computed(() => agent.draft.prepared)

onMounted(async () => {
  if (activeDocumentId.value) await agent.loadForDocument(activeDocumentId.value)
})

watch(activeDocumentId, async (id) => {
  if (id) await agent.loadForDocument(id)
})

watch(
  () => [agent.messages.length, agent.streaming],
  async () => {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  },
)

function autoGrow() {
  const element = input.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`
}

function usePrompt(prompt: string) {
  agent.setDraft({ question: prompt, stage: 'compose', error: '' })
  input.value?.focus()
}

async function send() {
  if (!canSend.value) return
  if (agent.draft.stage === 'preview') return
  try {
    const prepared = await agent.prepare()
    if (!prepared) return
    if (!settings.confirmBeforeSend) {
      await agent.send()
    }
  } catch (error) {
    ui.error('对话请求失败', friendlyMessage(error))
  }
}

async function confirmSend() {
  await agent.send()
}

function back() {
  agent.setDraft({ stage: 'compose', prepared: null })
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    if (agent.draft.stage === 'preview') confirmSend()
    else send()
  }
  if (event.key === 'Escape' && agent.draft.stage === 'preview') {
    back()
  }
}
</script>

<template>
  <div class="agent-panel">
    <div class="agent-header">
      <span>文档对话</span>
      <span class="agent-header__hint">只读分析</span>
    </div>

    <div ref="scroller" class="agent-messages" aria-live="polite">
      <div v-if="agent.loading" class="panel-loading"><Loader2 :size="15" class="spin" /> 正在载入对话…</div>
      <div v-else-if="!agent.messages.length && !agent.streaming" class="agent-empty">
        <Sparkles :size="20" />
        <p>向 Agent 提问，它只阅读、不改写正文。</p>
        <div class="agent-prompts">
          <button @click="usePrompt('总结这一节的主要论点，并指出缺失的证据。')">总结这一节</button>
          <button @click="usePrompt('检查这段论证是否有逻辑跳跃，只说明问题，不要改写。')">检查逻辑跳跃</button>
          <button @click="usePrompt('列出文中的术语不一致之处，并引用原文。')">术语一致性</button>
        </div>
      </div>
      <ChatMessage
        v-for="message in agent.messages"
        :key="message.id"
        :message="message"
        :citations="agent.citationsByMessage[message.id] ?? message.citations ?? []"
      />
      <article v-if="agent.streaming" class="chat-message chat-message--assistant">
        <div class="chat-message__role">Agent</div>
        <div class="chat-message__content">
          <span class="chat-message__text">{{ agent.streaming }}</span><span class="stream-caret" />
        </div>
      </article>
      <article v-else-if="agent.generating" class="chat-message chat-message--assistant">
        <div class="chat-message__role">Agent</div>
        <div class="chat-message__content agent-thinking">
          <Loader2 :size="14" class="spin" /> 正在思考…
        </div>
      </article>
    </div>

    <div v-if="agent.error" class="agent-error">
      <span>{{ agent.error }}</span>
      <button class="icon-button" aria-label="清除错误" @click="agent.error = ''"><X :size="13" /></button>
    </div>

    <div v-if="agent.draft.stage === 'preview' && preview" class="agent-preview">
      <OutboundPreview
        :messages="preview.messages"
        :outbound-chars="preview.outboundChars"
        :model="preview.model"
        :provider-host="preview.providerHost"
        :read-scope="preview.readScope"
        compact
      />
      <div class="agent-preview__actions">
        <button class="btn btn--ghost btn--small" @click="back">返回修改</button>
        <button class="btn btn--primary btn--small" @click="confirmSend">发送给模型</button>
      </div>
    </div>

    <div v-else class="agent-composer">
      <div class="agent-scope" role="group" aria-label="读取范围">
        <button
          class="segment"
          :class="{ 'is-active': agent.draft.scope === 'document' }"
          @click="agent.setDraft({ scope: 'document' })"
        >
          全文
        </button>
        <button
          class="segment"
          :class="{ 'is-active': agent.draft.scope === 'selection' }"
          @click="agent.setDraft({ scope: 'selection' })"
        >
          选区
        </button>
      </div>
      <textarea
        ref="input"
        v-model="agent.draft.question"
        class="agent-input"
        rows="2"
        placeholder="就当前文档提问…  Ctrl+Enter 发送"
        aria-label="向 Agent 提问"
        :disabled="agent.generating"
        @input="autoGrow"
        @keydown="keydown"
      />
      <div class="agent-composer__footer">
        <span class="agent-composer__hint">
          {{ agent.draft.scope === 'document' ? '将发送当前文档全文' : '将发送当前选区' }}
        </span>
        <button
          v-if="agent.generating"
          class="btn btn--small btn--danger"
          @click="agent.cancel()"
        >
          <Square :size="13" /> 取消
        </button>
        <button v-else class="btn btn--primary btn--small" :disabled="!canSend" @click="send">
          <Send :size="13" /> 请求
        </button>
      </div>
    </div>
  </div>
</template>
