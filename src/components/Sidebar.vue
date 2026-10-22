<script setup lang="ts">
import { computed } from 'vue'
import { FileText, FolderOpen, PanelLeftClose, RefreshCw, Sparkles } from 'lucide-vue-next'
import FileTreeNode from './FileTreeNode.vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { friendlyMessage } from '@/lib/errors'
import { openFile, openFolder } from '@/features/files/openFile'

const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const ui = useUiStore()

const recentVisible = computed(() => workspace.recent.slice(0, 8))

async function pickFile() {
  try {
    await workspace.pickAndOpenFile()
  } catch (error) {
    ui.error('打开文件失败', friendlyMessage(error))
  }
}
</script>

<template>
  <aside class="sidebar" aria-label="文件与最近文档">
    <header class="sidebar__header">
      <span class="sidebar__title">工作区</span>
      <div class="sidebar__actions">
        <button class="icon-button" aria-label="打开文件" title="打开文件 (Ctrl+O)" @click="pickFile">
          <FileText :size="15" />
        </button>
        <button class="icon-button" aria-label="打开文件夹" title="打开文件夹 (Ctrl+Shift+O)" @click="openFolder()">
          <FolderOpen :size="15" />
        </button>
        <button
          class="icon-button"
          aria-label="刷新文件树"
          title="刷新文件树"
          :disabled="!workspace.project"
          @click="workspace.refreshTree()"
        >
          <RefreshCw :size="15" />
        </button>
        <button class="icon-button" aria-label="收起侧栏" title="收起侧栏" @click="settings.update({ sidebarOpen: false })">
          <PanelLeftClose :size="15" />
        </button>
      </div>
    </header>

    <div class="sidebar__scroll">
      <section v-if="workspace.project" class="sidebar__section">
        <div class="project-card">
          <div class="project-card__name" :title="workspace.project.rootPath">
            {{ workspace.project.name }}
          </div>
          <div class="project-card__path" :title="workspace.project.rootPath">
            {{ workspace.project.rootPath }}
          </div>
        </div>
        <nav class="file-tree" role="tree" aria-label="文件树">
          <FileTreeNode
            v-for="node in workspace.tree?.children ?? []"
            :key="node.path"
            :node="node"
            :depth="0"
            :active-path="workspace.activeDocument?.path ?? ''"
            @open="openFile"
          />
          <p v-if="!workspace.tree?.children.length" class="sidebar__empty">
            这个文件夹里还没有 Markdown 文件。
          </p>
        </nav>
      </section>

      <section v-else class="sidebar__section sidebar__section--empty">
        <p class="sidebar__hint">打开一个文件夹，开始整理你的写作项目。</p>
        <button class="btn btn--primary btn--block" @click="openFolder()">打开文件夹</button>
      </section>

      <section class="sidebar__section">
        <div class="sidebar__section-head">
          <span>最近文档</span>
          <span class="count">{{ workspace.recent.length }}</span>
        </div>
        <ul class="recent-list">
          <li v-for="item in recentVisible" :key="item.path">
            <button
              class="recent-item"
              :class="{ 'is-missing': !item.exists }"
              :disabled="!item.exists"
              :title="item.path"
              @click="openFile(item.path)"
            >
              <span class="recent-item__title">{{ item.title }}</span>
              <span class="recent-item__path">{{ item.path }}</span>
            </button>
          </li>
          <li v-if="!workspace.recent.length" class="sidebar__empty">还没有打开过文档。</li>
        </ul>
      </section>
    </div>

    <footer class="sidebar__footer">
      <button class="sidebar__style" :disabled="!workspace.project" @click="ui.styleOpen = true">
        <span class="sidebar__style-icon"><Sparkles :size="15" /></span>
        <span class="sidebar__style-text">
          <strong>项目风格卡</strong>
          <small>{{ workspace.project ? '约束语气与术语' : '需要先打开文件夹' }}</small>
        </span>
      </button>
    </footer>
  </aside>
</template>
