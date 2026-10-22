<script setup lang="ts">
import { FilePlus2, FolderOpen, Keyboard, Sparkles } from 'lucide-vue-next'
import AppLogo from './AppLogo.vue'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'
import { openFolder } from '@/features/files/openFile'

const workspace = useWorkspaceStore()
const ui = useUiStore()

async function newDocument() {
  try {
    await workspace.createDocument()
  } catch (error) {
    ui.error('新建文档失败', friendlyMessage(error))
  }
}

async function pickFile() {
  try {
    await workspace.pickAndOpenFile()
  } catch (error) {
    ui.error('打开文件失败', friendlyMessage(error))
  }
}
</script>

<template>
  <main class="empty-state">
    <div class="empty-state__inner">
      <div class="empty-state__mark"><AppLogo :size="64" /></div>
      <p class="empty-state__eyebrow">HUMAN-LED · AGENT-ASSISTED</p>
      <h1>把文字留在自己手里</h1>
      <p class="empty-state__lead">
        文屿是一个本地优先的 Markdown 写作台。AI 只提出候选，是否改动、改动哪一段，始终由你决定。
      </p>
      <div class="empty-state__actions">
        <button class="btn btn--primary" @click="pickFile">
          <FilePlus2 :size="16" /> 打开文件
        </button>
        <button class="btn" @click="openFolder()">
          <FolderOpen :size="16" /> 打开文件夹
        </button>
        <button class="btn btn--ghost" @click="newDocument">新建文稿</button>
      </div>
      <ul class="empty-state__features">
        <li><Sparkles :size="15" /> 选中文字，按 <kbd>Ctrl</kbd> + <kbd>J</kbd> 请求行内建议</li>
        <li>原文是唯一真源，未接受的建议永不写入磁盘</li>
        <li>每次接受都可一步撤销，并在应用前留下快照</li>
      </ul>
      <button class="empty-state__shortcuts" @click="ui.shortcutsOpen = true">
        <Keyboard :size="14" /> 查看快捷键
      </button>
    </div>
  </main>
</template>
