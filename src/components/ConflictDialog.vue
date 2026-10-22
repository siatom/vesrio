<script setup lang="ts">
import { computed, ref } from 'vue'
import { AlertTriangle, Loader2 } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'

const workspace = useWorkspaceStore()
const ui = useUiStore()
const busy = ref(false)

const tab = computed(() => workspace.activeTab)
const visible = computed(() => tab.value?.saveState === 'conflict')

async function reload() {
  busy.value = true
  try {
    await workspace.reloadTab()
    ui.success('已重新载入磁盘版本', '本地未保存内容已提前创建快照，可在「修订」中找回')
  } catch (error) {
    ui.error('重新载入失败', friendlyMessage(error))
  } finally {
    busy.value = false
  }
}

async function overwrite() {
  busy.value = true
  try {
    await workspace.save(undefined, true)
    ui.success('已用当前内容覆盖磁盘文件')
  } catch (error) {
    ui.error('覆盖保存失败', friendlyMessage(error))
  } finally {
    busy.value = false
  }
}

async function saveAs() {
  busy.value = true
  try {
    await workspace.saveAs()
  } catch (error) {
    ui.error('另存为失败', friendlyMessage(error))
  } finally {
    busy.value = false
  }
}

function dismiss() {
  const current = tab.value
  if (!current) return
  current.saveState = current.dirty ? 'dirty' : 'saved'
  current.saveError = ''
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible && tab" class="modal-backdrop" @click.self="dismiss">
        <div class="modal modal--small" role="alertdialog" aria-modal="true" aria-label="外部冲突">
          <header class="modal__header">
            <div class="modal__title">
              <AlertTriangle :size="18" class="text-warn" />
              <h2>文件已在磁盘上改变</h2>
            </div>
          </header>
          <div class="modal__body">
            <p class="dialog-text">
              <strong>{{ tab.document.title }}</strong> 在 Vesrio 之外被修改过。你有未保存的本地内容，Vesrio 不会自动覆盖任何一方。
            </p>
            <p class="dialog-text dialog-text--muted">
              重新载入会先为当前内容创建快照；保留当前会覆盖磁盘版本；另存为会保留两个版本。
            </p>
          </div>
          <footer class="modal__footer modal__footer--stack">
            <button class="btn btn--block" :disabled="busy" @click="reload">
              <Loader2 v-if="busy" :size="14" class="spin" /> 重新载入磁盘版本
            </button>
            <button class="btn btn--block" :disabled="busy" @click="overwrite">保留当前内容并覆盖</button>
            <button class="btn btn--block" :disabled="busy" @click="saveAs">另存为副本…</button>
            <button class="btn btn--ghost btn--block" :disabled="busy" @click="dismiss">稍后处理</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
