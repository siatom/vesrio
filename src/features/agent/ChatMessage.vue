<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle, Quote } from 'lucide-vue-next'
import type { Citation, MessageRecord } from '@/lib/types'
import { useAgentStore } from '@/stores/agent'

const props = defineProps<{
  message: MessageRecord
  citations: Citation[]
}>()

const agent = useAgentStore()

type Segment = { kind: 'text'; text: string } | { kind: 'cite'; label: string; citation: Citation | null }

const segments = computed<Segment[]>(() => {
  const regex = /\[\[cite:([^[]+?)\]\]/g
  const result: Segment[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(props.message.content)) !== null) {
    if (match.index > last) {
      result.push({ kind: 'text', text: props.message.content.slice(last, match.index) })
    }
    const label = (match[1] ?? '').trim()
    const citation = props.citations.find((item) => item.text === label) ?? null
    result.push({ kind: 'cite', label, citation })
    last = match.index + match[0].length
  }
  if (last < props.message.content.length) {
    result.push({ kind: 'text', text: props.message.content.slice(last) })
  }
  return result
})
</script>

<template>
  <article class="chat-message" :class="`chat-message--${message.role}`">
    <div class="chat-message__role">{{ message.role === 'user' ? '你' : 'Agent' }}</div>
    <div class="chat-message__content">
      <template v-for="(segment, index) in segments" :key="index">
        <span v-if="segment.kind === 'text'" class="chat-message__text">{{ segment.text }}</span>
        <button
          v-else
          class="citation-chip"
          :class="{ 'citation-chip--missing': !segment.citation?.resolved }"
          :title="segment.citation?.resolved ? '跳到原文' : '来源已变化，无法定位'"
          @click="segment.citation && agent.jumpToCitation(segment.citation)"
        >
          <AlertCircle v-if="!segment.citation?.resolved" :size="11" />
          <Quote v-else :size="11" />
          {{ segment.label }}
        </button>
      </template>
    </div>
  </article>
</template>
