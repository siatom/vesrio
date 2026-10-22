<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const visible = computed(() => Boolean(ui.confirm || ui.choice))
const title = computed(() => ui.confirm?.title ?? ui.choice?.title ?? '')
const message = computed(() => ui.confirm?.message ?? ui.choice?.message ?? '')
const danger = computed(() => Boolean(ui.confirm?.danger ?? ui.choice?.danger))

function cancel() {
  if (ui.choice) ui.resolveChoice('cancel')
  else ui.resolveConfirm(false)
}
function confirmPrimary() {
  if (ui.choice) ui.resolveChoice('primary')
  else ui.resolveConfirm(true)
}
function confirmSecondary() {
  if (ui.choice) ui.resolveChoice('secondary')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="modal-backdrop" @click.self="cancel">
        <div class="modal modal--small" role="dialog" aria-modal="true" :aria-label="title">
          <header class="modal__header">
            <h2>{{ title }}</h2>
            <button class="icon-button" aria-label="关闭" @click="cancel"><X :size="18" /></button>
          </header>
          <div class="modal__body">
            <p class="dialog-text">{{ message }}</p>
          </div>
          <footer class="modal__footer">
            <button class="btn btn--ghost" @click="cancel">
              {{ ui.confirm?.cancelLabel ?? '取消' }}
            </button>
            <button v-if="ui.choice" class="btn" :class="{ 'btn--danger': danger }" @click="confirmSecondary">
              {{ ui.choice.secondary }}
            </button>
            <button
              class="btn"
              :class="danger ? 'btn--danger' : 'btn--primary'"
              @click="confirmPrimary"
            >
              {{ ui.confirm?.confirmLabel ?? ui.choice?.primary ?? '确定' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
