<script setup lang="ts">
import { ShieldCheck } from 'lucide-vue-next'
import type { ChatMessagePayload } from '@/lib/types'

const props = defineProps<{
  messages: ChatMessagePayload[]
  outboundChars: number
  model: string
  providerHost: string
  readScope: string
  compact?: boolean
}>()

const scopeLabels: Record<string, string> = {
  selection: '仅选区',
  selection_with_paragraph_context: '选区 + 所在段落',
  document: '当前文档全文',
  none: '不发送文档内容',
}
</script>

<template>
  <section class="outbound" :class="{ 'outbound--compact': props.compact }">
    <div class="outbound__summary">
      <ShieldCheck :size="16" aria-hidden="true" />
      <span>
        将发送至 <strong>{{ providerHost }}</strong> · {{ model }} ·
        {{ outboundChars.toLocaleString() }} 字
      </span>
    </div>
    <p class="outbound__scope">
      读取范围：{{ scopeLabels[readScope] ?? readScope }} · 写入范围：仅选区（模型无文件写入权限）
    </p>
    <details class="outbound__details">
      <summary>查看将发送的原始内容</summary>
      <div class="outbound__messages">
        <article v-for="(message, index) in messages" :key="index" class="outbound__message">
          <header>{{ message.role === 'system' ? '系统约束' : '用户内容' }}</header>
          <pre>{{ message.content }}</pre>
        </article>
      </div>
    </details>
    <p class="outbound__privacy">
      内容只发送到你自己配置的模型服务。Vesrio 不上传文档，也不会在日志中记录正文。
    </p>
  </section>
</template>
