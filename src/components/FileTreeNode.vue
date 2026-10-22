<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, FileText, Folder, FolderOpen } from 'lucide-vue-next'
import type { FileNode } from '@/lib/types'

defineOptions({ name: 'FileTreeNode' })

const props = defineProps<{
  node: FileNode
  depth: number
  activePath: string
}>()

const emit = defineEmits<{ open: [path: string] }>()

const expanded = ref(props.depth < 2)
const active = computed(() => !props.node.isDir && props.node.path === props.activePath)

function open() {
  if (props.node.isDir) expanded.value = !expanded.value
  else if (props.node.isDir === false) emit('open', props.node.path)
}
</script>

<template>
  <div class="tree-node" :class="{ 'tree-node--dir': node.isDir }">
    <button
      v-if="node.isDir"
      class="tree-row"
      :style="{ paddingLeft: `${10 + depth * 14}px` }"
      :aria-expanded="expanded"
      @click="open"
    >
      <ChevronRight :size="13" class="tree-chevron" :class="{ 'is-open': expanded }" />
      <FolderOpen v-if="expanded" :size="14" class="tree-icon" />
      <Folder v-else :size="14" class="tree-icon" />
      <span class="tree-label">{{ node.name }}</span>
    </button>
    <button
      v-else
      class="tree-row tree-row--file"
      :class="{ 'is-active': active }"
      :style="{ paddingLeft: `${24 + depth * 14}px` }"
      :title="node.path"
      @click="emit('open', node.path)"
    >
      <FileText :size="14" class="tree-icon" />
      <span class="tree-label">{{ node.name }}</span>
    </button>
    <div v-if="node.isDir && expanded" class="tree-children" role="group">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :active-path="activePath"
        @open="emit('open', $event)"
      />
    </div>
  </div>
</template>
