<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

const groups = [
  {
    title: '文件',
    items: [
      ['Ctrl + O', '打开文件'],
      ['Ctrl + Shift + O', '打开文件夹'],
      ['Ctrl + N', '新建文稿'],
      ['Ctrl + S', '保存'],
      ['Ctrl + Shift + S', '另存为'],
      ['Ctrl + W', '关闭标签'],
    ],
  },
  {
    title: '写作与 AI',
    items: [
      ['Ctrl + J', '对选区请求 AI 建议'],
      ['Ctrl + K', '命令面板'],
      ['Ctrl + F', '查找 / 替换'],
      ['Ctrl + Z / Ctrl + Shift + Z', '撤销 / 重做'],
      ['Ctrl + Shift + M', '创建快照'],
      ['Ctrl + Enter', '在 AI 对话框中生成 / 发送'],
    ],
  },
  {
    title: '界面',
    items: [
      ['Ctrl + Shift + F', '专注模式（Esc 退出）'],
      ['Ctrl + Shift + R', '审阅模式'],
      ['Ctrl + 1 / 2 / 3', '大纲 / Agent / 修订'],
      ['Ctrl + ,', '设置'],
      ['Ctrl + /', '快捷键说明'],
      ['Esc', '关闭当前浮层'],
    ],
  },
  {
    title: '建议卡（聚焦时）',
    items: [
      ['Enter', '接受当前候选'],
      ['← / →', '切换候选'],
      ['Alt + Backspace', '拒绝'],
      ['Esc', '关闭或取消生成'],
    ],
  },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="ui.shortcutsOpen" class="modal-backdrop" @click.self="ui.shortcutsOpen = false">
        <div class="modal modal--wide" role="dialog" aria-modal="true" aria-label="快捷键">
          <header class="modal__header">
            <div class="modal__title"><h2>快捷键</h2></div>
            <button class="icon-button" aria-label="关闭" @click="ui.shortcutsOpen = false"><X :size="18" /></button>
          </header>
          <div class="modal__body shortcuts-grid">
            <section v-for="group in groups" :key="group.title" class="shortcut-group">
              <h3>{{ group.title }}</h3>
              <dl>
                <div v-for="item in group.items" :key="item[0]" class="shortcut-row">
                  <dt><kbd>{{ item[0] }}</kbd></dt>
                  <dd>{{ item[1] }}</dd>
                </div>
              </dl>
            </section>
          </div>
          <footer class="modal__footer">
            <span class="modal__footer-hint">所有核心操作都有键盘路径；输入法组合期间不会触发单键快捷键。</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
