<script setup lang="ts">
import { computed, ref } from 'vue'
import { FileWarning, Loader2 } from 'lucide-vue-next'
import { openWithEncoding } from '@/features/files/openFile'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const busy = ref(false)
const prompt = computed(() => ui.encodingPrompt)
const label = computed(() => (prompt.value?.encoding ?? '').toUpperCase())

async function convert() {
  if (!prompt.value) return
  busy.value = true
  try {
    const ok = await openWithEncoding(prompt.value.path, prompt.value.encoding)
    if (ok) ui.encodingPrompt = null
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="prompt" class="modal-backdrop" @click.self="ui.encodingPrompt = null">
        <div class="modal modal--small" role="dialog" aria-modal="true" aria-label="编码提示">
          <header class="modal__header">
            <div class="modal__title">
              <FileWarning :size="18" />
              <h2>非 UTF-8 文件</h2>
            </div>
          </header>
          <div class="modal__body">
            <p class="dialog-text">
              这个文件不是 UTF-8 编码（检测为 <strong>{{ label }}</strong>）。Vesrio 不会静默转码。
            </p>
            <p class="dialog-text dialog-text--muted">
              只有在你保存后，文件才会写成 UTF-8。原始字节在你确认前保持不变。
            </p>
            <p class="dialog-text dialog-text--muted path-text">{{ prompt.path }}</p>
          </div>
          <footer class="modal__footer">
            <button class="btn btn--ghost" @click="ui.encodingPrompt = null">取消</button>
            <button class="btn btn--primary" :disabled="busy" @click="convert">
              <Loader2 v-if="busy" :size="14" class="spin" />
              以 {{ label }} 打开
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
