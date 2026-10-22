<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

const icons = {
  info: Info,
  success: CircleCheck,
  warn: TriangleAlert,
  error: CircleAlert,
}
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="toast"
        :class="`toast--${toast.kind}`"
        role="status"
      >
        <component :is="icons[toast.kind]" :size="17" class="toast__icon" aria-hidden="true" />
        <div class="toast__body">
          <div class="toast__message">{{ toast.message }}</div>
          <div v-if="toast.detail" class="toast__detail">{{ toast.detail }}</div>
        </div>
        <button class="icon-button toast__close" aria-label="关闭提示" @click="ui.dismissToast(toast.id)">
          <X :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
