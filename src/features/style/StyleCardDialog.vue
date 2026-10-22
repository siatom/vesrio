<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Save, Sparkles, X } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { useStyleStore } from '@/stores/style'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

const style = useStyleStore()
const workspace = useWorkspaceStore()
const ui = useUiStore()
const settings = useSettingsStore()

const newTerm = ref('')
const newPreferred = ref('')
const newBanned = ref('')

const projectId = computed(() => workspace.project?.id ?? null)
const currentVersion = computed(() => style.versionLabel)

onMounted(async () => {
  await style.load(projectId.value)
})

async function save() {
  const profile = await style.save()
  if (profile) {
    await settings.update({ inspectorTab: 'agent' })
  }
}

function addTerm() {
  const term = newTerm.value.trim()
  if (!term) return
  style.rules.terminology.push({ term, preferred: newPreferred.value.trim() })
  newTerm.value = ''
  newPreferred.value = ''
}

function removeTerm(index: number) {
  style.rules.terminology.splice(index, 1)
}

function addBanned() {
  const value = newBanned.value.trim()
  if (!value || style.rules.banned.includes(value)) return
  style.rules.banned.push(value)
  newBanned.value = ''
}

function removeBanned(index: number) {
  style.rules.banned.splice(index, 1)
}

function close() {
  ui.styleOpen = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="ui.styleOpen" class="modal-backdrop" @click.self="close">
        <div class="modal modal--wide" role="dialog" aria-modal="true" aria-label="项目风格卡">
          <header class="modal__header">
            <div class="modal__title">
              <Sparkles :size="17" />
              <h2>项目风格卡</h2>
              <span class="pill">{{ currentVersion }}</span>
            </div>
            <button class="icon-button" aria-label="关闭" @click="close"><X :size="18" /></button>
          </header>

          <div v-if="!projectId" class="modal__body">
            <p class="dialog-text">打开一个文件夹项目后，可以为这个项目建立独立的风格约束。</p>
          </div>

          <div v-else class="modal__body style-body">
            <p class="privacy-note">
              风格卡只影响这个项目的新请求。优先级：即时指令 &gt; 项目风格 &gt; 默认风格；与即时指令冲突时以即时指令为准。
            </p>

            <div class="field-grid">
              <label class="field">
                <span class="field__label">目标受众</span>
                <input v-model="style.rules.audience" class="input" placeholder="例如：非技术背景的产品经理" />
              </label>
              <label class="field">
                <span class="field__label">口吻与节奏</span>
                <input v-model="style.rules.tone" class="input" placeholder="例如：平实、克制、适量举例" />
              </label>
            </div>

            <section class="style-section">
              <h3>术语规范</h3>
              <div v-if="style.rules.terminology.length" class="term-list">
                <div v-for="(term, index) in style.rules.terminology" :key="`${term.term}-${index}`" class="term-row">
                  <span class="term-source">{{ term.term }}</span>
                  <span class="term-arrow">→</span>
                  <span class="term-target">{{ term.preferred || '保持原词' }}</span>
                  <button class="icon-button" aria-label="删除术语" @click="removeTerm(index)"><X :size="13" /></button>
                </div>
              </div>
              <div class="term-add">
                <input v-model="newTerm" class="input" placeholder="原词 / 不希望出现的写法" />
                <input v-model="newPreferred" class="input" placeholder="替换为（可留空）" @keydown.enter.prevent="addTerm" />
                <button class="btn btn--small" @click="addTerm"><Plus :size="13" /> 添加</button>
              </div>
            </section>

            <section class="style-section">
              <h3>禁用表达</h3>
              <div v-if="style.rules.banned.length" class="tag-list">
                <span v-for="(item, index) in style.rules.banned" :key="`${item}-${index}`" class="tag">
                  {{ item }}
                  <button class="tag__remove" :aria-label="`删除 ${item}`" @click="removeBanned(index)"><X :size="11" /></button>
                </span>
              </div>
              <div class="term-add">
                <input v-model="newBanned" class="input" placeholder="例如：赋能、颠覆式、无脑" @keydown.enter.prevent="addBanned" />
                <button class="btn btn--small" @click="addBanned"><Plus :size="13" /> 添加</button>
              </div>
            </section>

            <label class="field">
              <span class="field__label">补充要求</span>
              <textarea
                v-model="style.rules.notes"
                class="textarea"
                rows="3"
                placeholder="例如：保持条件性表述，不把「可能」改成「会」。"
              />
            </label>

            <p v-if="style.error" class="settings-error">{{ style.error }}</p>
          </div>

          <footer class="modal__footer">
            <span class="modal__footer-hint">保存后版本号递增，旧请求仍保留当时的风格版本。</span>
            <div class="modal__footer-actions">
              <button class="btn btn--ghost" @click="close">取消</button>
              <button class="btn btn--primary" :disabled="!projectId || style.saving" @click="save">
                <Save :size="14" /> {{ style.saving ? '保存中…' : '保存风格卡' }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
