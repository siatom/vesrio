<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Camera, History, Loader2, RotateCcw } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { friendlyMessage } from '@/lib/errors'
import type { SnapshotRecord } from '@/lib/types'
import { formatBytes, formatDateTime } from '@/lib/text'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

const workspace = useWorkspaceStore()
const ui = useUiStore()
const snapshots = ref<SnapshotRecord[]>([])
const loading = ref(false)
const busy = ref(false)

const sourceLabels: Record<string, string> = {
  manual: '手动快照',
  ai_apply: 'AI 应用前',
  before_restore: '恢复前保护',
  conflict: '冲突保护',
}

const documentId = computed(() => workspace.activeDocument?.id ?? null)

async function load() {
  if (!documentId.value) {
    snapshots.value = []
    return
  }
  loading.value = true
  try {
    snapshots.value = await api.listSnapshots(documentId.value)
  } catch (error) {
    ui.error('读取快照失败', friendlyMessage(error))
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(documentId, load)

async function createSnapshot() {
  busy.value = true
  try {
    await workspace.createManualSnapshot()
    ui.success('已创建快照')
    await load()
  } catch (error) {
    ui.error('创建快照失败', friendlyMessage(error))
  } finally {
    busy.value = false
  }
}

async function restore(snapshot: SnapshotRecord) {
  const confirmed = await ui.askConfirm({
    title: '恢复到这个快照？',
    message: `当前内容会先自动创建一份「恢复前保护」快照，然后编辑器中的正文将替换为 ${formatDateTime(
      snapshot.createdAt,
    )} 的快照。恢复后需要保存才会写入磁盘。`,
    confirmLabel: '恢复',
  })
  if (!confirmed) return
  busy.value = true
  try {
    await workspace.restoreSnapshot(snapshot.id)
    ui.success('已恢复到快照', '正文尚未保存，按 Ctrl+S 写入磁盘')
    await load()
  } catch (error) {
    ui.error('恢复失败', friendlyMessage(error))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="revisions-panel">
    <div class="panel-heading">
      <span>修订与快照</span>
      <button class="icon-button" :disabled="busy || !documentId" title="创建快照" aria-label="创建快照" @click="createSnapshot">
        <Camera :size="15" />
      </button>
    </div>
    <p class="panel-note">
      快照保存在本地应用数据目录，不会改动你的 Markdown 源文件。
    </p>
    <div v-if="loading" class="panel-loading"><Loader2 :size="15" class="spin" /> 正在读取…</div>
    <ul v-else-if="snapshots.length" class="snapshot-list">
      <li v-for="snapshot in snapshots" :key="snapshot.id" class="snapshot-item">
        <div class="snapshot-item__icon"><History :size="15" /></div>
        <div class="snapshot-item__body">
          <div class="snapshot-item__title">
            {{ sourceLabels[snapshot.source] ?? snapshot.source }}
          </div>
          <div class="snapshot-item__meta">
            {{ formatDateTime(snapshot.createdAt) }} · {{ formatBytes(snapshot.sizeBytes) }}
          </div>
        </div>
        <button
          class="btn btn--small"
          :disabled="busy"
          title="恢复此快照"
          @click="restore(snapshot)"
        >
          <RotateCcw :size="13" /> 恢复
        </button>
      </li>
    </ul>
    <p v-else class="panel-empty">
      还没有快照。接受 AI 建议前会自动创建，也可以用上方按钮手动记录。
    </p>
  </div>
</template>
