<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Check,
  ExternalLink,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { AppInfo, ProviderConfigView } from '@/lib/types'
import { friendlyMessage } from '@/lib/errors'
import { shortcutModifier } from '@/lib/platform'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

type Tab = 'appearance' | 'editing' | 'provider' | 'data'

const settings = useSettingsStore()
const ui = useUiStore()

const tab = ref<Tab>('appearance')
const appInfo = ref<AppInfo | null>(null)
const paths = ref<Record<string, string>>({})
const provider = ref<ProviderConfigView | null>(null)
const apiKey = ref('')
const removeKey = ref(false)
const savingProvider = ref(false)
const testing = ref(false)
const testResult = ref('')
const testError = ref('')

const providerForm = reactive({
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  timeoutMs: 60000,
  temperature: 0.4,
  maxTokens: 384000,
})

const providerPresets = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
} as const

function applyPreset(name: keyof typeof providerPresets) {
  Object.assign(providerForm, providerPresets[name])
}

const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'appearance', label: '外观', icon: Sparkles },
  { id: 'editing', label: '编辑', icon: SlidersHorizontal },
  { id: 'provider', label: '模型服务', icon: ShieldCheck },
  { id: 'data', label: '数据', icon: ExternalLink },
]

const keyState = computed(() => {
  if (removeKey.value) return '保存后将删除 Key'
  if (provider.value?.credentialError) return '凭据库不可用'
  if (apiKey.value.trim()) return '保存后更新 Key'
  return provider.value?.hasApiKey ? '已安全保存' : '尚未配置'
})

const credentialBackendLabel = computed(() => {
  switch (provider.value?.credentialBackend) {
    case 'windows-credential-manager':
      return 'Windows 凭据管理器'
    case 'macos-keychain':
      return 'macOS 钥匙串'
    case 'linux-secret-service':
      return 'Linux Secret Service'
    default:
      return '系统凭据库'
  }
})

onMounted(async () => {
  try {
    appInfo.value = await api.appInfo()
    paths.value = await api.debugPaths()
  } catch {
    // Settings still works without diagnostics.
  }
  await loadProvider()
})

async function loadProvider() {
  try {
    const config = await api.getProviderConfig()
    provider.value = config
    providerForm.baseUrl = config.baseUrl
    providerForm.model = config.model
    providerForm.timeoutMs = config.timeoutMs
    providerForm.temperature = config.temperature
    providerForm.maxTokens = config.maxTokens
  } catch (error) {
    ui.error('读取模型配置失败', friendlyMessage(error))
  }
}

async function saveProvider() {
  if (!providerForm.baseUrl.startsWith('http://') && !providerForm.baseUrl.startsWith('https://')) {
    ui.error('Base URL 需要以 http:// 或 https:// 开头')
    return
  }
  savingProvider.value = true
  testError.value = ''
  testResult.value = ''
  try {
    const updated = await api.saveProviderConfig(
      { ...providerForm },
      apiKey.value.trim() || null,
      removeKey.value,
    )
    provider.value = updated
    apiKey.value = ''
    removeKey.value = false
    ui.success('模型配置已保存', `API Key 只写入${credentialBackendLabel.value}`)
  } catch (error) {
    ui.error('保存模型配置失败', friendlyMessage(error))
  } finally {
    savingProvider.value = false
  }
}

async function testConnection() {
  testing.value = true
  testError.value = ''
  testResult.value = ''
  try {
    const result = await api.testProvider()
    testResult.value = `已连接 ${result.host}，发现 ${result.models.length} 个模型。`
  } catch (error) {
    testError.value = friendlyMessage(error)
  } finally {
    testing.value = false
  }
}

function close() {
  ui.settingsOpen = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="ui.settingsOpen" class="modal-backdrop" @click.self="close">
        <div class="modal modal--settings" role="dialog" aria-modal="true" aria-label="设置">
          <header class="modal__header">
            <div class="modal__title"><h2>设置</h2></div>
            <button class="icon-button" aria-label="关闭" @click="close"><X :size="18" /></button>
          </header>

          <div class="settings-layout">
            <nav class="settings-nav" aria-label="设置分类">
              <button
                v-for="item in tabs"
                :key="item.id"
                class="settings-nav__item"
                :class="{ 'is-active': tab === item.id }"
                @click="tab = item.id"
              >
                <component :is="item.icon" :size="15" />
                {{ item.label }}
              </button>
            </nav>

            <div class="settings-panel">
              <template v-if="tab === 'appearance'">
                <section class="settings-section">
                  <h3>主题</h3>
                  <p class="settings-help">跟随系统，或固定为浅色 / 深色。两种主题都满足正文对比度要求。</p>
                  <div class="segmented">
                    <button
                      v-for="option in [
                        { value: 'system', label: '跟随系统' },
                        { value: 'light', label: '浅色' },
                        { value: 'dark', label: '深色' },
                      ]"
                      :key="option.value"
                      class="segment"
                      :class="{ 'is-active': settings.theme === option.value }"
                      @click="settings.update({ theme: option.value as typeof settings.theme })"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                </section>

                <section class="settings-section">
                  <h3>正文字体</h3>
                  <div class="segmented">
                    <button
                      v-for="option in [
                        { value: 'serif', label: '衬线' },
                        { value: 'sans', label: '无衬线' },
                        { value: 'mono', label: '等宽' },
                      ]"
                      :key="option.value"
                      class="segment"
                      :class="{ 'is-active': settings.editorFont === option.value }"
                      @click="settings.update({ editorFont: option.value as typeof settings.editorFont })"
                    >
                      {{ option.label }}
                    </button>
                  </div>
                  <div class="range-row">
                    <label for="font-size">字号</label>
                    <input
                      id="font-size"
                      type="range"
                      min="12"
                      max="28"
                      step="1"
                      :value="settings.fontSize"
                      @change="settings.update({ fontSize: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="range-value">{{ settings.fontSize }} px</span>
                  </div>
                  <div class="range-row">
                    <label for="line-height">行距</label>
                    <input
                      id="line-height"
                      type="range"
                      min="1.2"
                      max="2.2"
                      step="0.05"
                      :value="settings.lineHeight"
                      @change="settings.update({ lineHeight: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="range-value">{{ settings.lineHeight.toFixed(2) }}</span>
                  </div>
                  <div class="range-row">
                    <label for="editor-width">编辑栏宽</label>
                    <input
                      id="editor-width"
                      type="range"
                      min="480"
                      max="1100"
                      step="20"
                      :value="settings.editorWidth"
                      @change="settings.update({ editorWidth: Number(($event.target as HTMLInputElement).value) })"
                    />
                    <span class="range-value">{{ settings.editorWidth }} px</span>
                  </div>
                </section>
              </template>

              <template v-else-if="tab === 'editing'">
                <section class="settings-section">
                  <h3>写作行为</h3>
                  <label class="toggle-row">
                    <span>
                      <strong>发送前确认外发内容</strong>
                      <small>每次调用模型前显示将发送的完整文本。建议保持开启。</small>
                    </span>
                    <input
                      type="checkbox"
                      :checked="settings.confirmBeforeSend"
                      @change="settings.update({ confirmBeforeSend: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                  <label class="toggle-row">
                    <span>
                      <strong>应用建议前自动创建快照</strong>
                      <small>接受 AI 建议前保留当前正文，可随时恢复。</small>
                    </span>
                    <input
                      type="checkbox"
                      :checked="settings.autoSnapshot"
                      @change="settings.update({ autoSnapshot: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                  <label class="toggle-row">
                    <span>
                      <strong>打字机滚动</strong>
                      <small>让光标保持在编辑区中部，减少视线移动。</small>
                    </span>
                    <input
                      type="checkbox"
                      :checked="settings.typewriterMode"
                      @change="settings.update({ typewriterMode: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                </section>
                <section class="settings-section">
                  <h3>审阅模式</h3>
                  <label class="toggle-row">
                    <span>
                      <strong>启动时进入审阅模式</strong>
                      <small>优先显示建议、问题与大钢定位。</small>
                    </span>
                    <input
                      type="checkbox"
                      :checked="settings.reviewMode"
                      @change="settings.update({ reviewMode: ($event.target as HTMLInputElement).checked })"
                    />
                  </label>
                </section>
              </template>

              <template v-else-if="tab === 'provider'">
                <section class="settings-section">
                  <h3>OpenAI-compatible 服务</h3>
                  <p class="settings-help">
                    Vesrio 直接从本机访问你填写的基础地址。API Key 只保存在{{ credentialBackendLabel }}，不进入 SQLite、JSON 或日志。
                  </p>
                  <div class="provider-presets" role="group" aria-label="服务预设">
                    <span class="settings-help">快速填充：</span>
                    <button class="btn btn--small" type="button" @click="applyPreset('deepseek')">
                      DeepSeek
                    </button>
                    <button class="btn btn--small" type="button" @click="applyPreset('openai')">
                      OpenAI
                    </button>
                  </div>
                  <label class="field">
                    <span class="field__label">Base URL</span>
                    <input
                      v-model="providerForm.baseUrl"
                      class="input"
                      aria-label="Base URL"
                      placeholder="https://api.deepseek.com"
                    />
                  </label>
                  <div class="field-grid">
                    <label class="field">
                      <span class="field__label">模型名称</span>
                      <input
                        v-model="providerForm.model"
                        class="input"
                        aria-label="模型名称"
                        placeholder="deepseek-flash"
                      />
                    </label>
                    <label class="field">
                      <span class="field__label">超时（毫秒）</span>
                      <input v-model.number="providerForm.timeoutMs" class="input" type="number" min="1000" max="600000" step="1000" />
                    </label>
                  </div>
                  <div class="field-grid">
                    <label class="field">
                      <span class="field__label">Temperature</span>
                      <input v-model.number="providerForm.temperature" class="input" type="number" min="0" max="2" step="0.1" />
                    </label>
                    <label class="field">
                      <span class="field__label">最大输出 Token</span>
                      <input v-model.number="providerForm.maxTokens" class="input" type="number" min="64" max="384000" step="64" />
                    </label>
                  </div>
                  <label class="field">
                    <span class="field__label">API Key（{{ keyState }}）</span>
                    <input
                      v-model="apiKey"
                      class="input"
                      type="password"
                      autocomplete="off"
                      aria-label="API Key"
                      placeholder="留空则保持现有 Key"
                    />
                  </label>
                  <p v-if="provider?.credentialError" class="settings-error">
                    系统凭据库不可用：{{ provider.credentialError }}
                  </p>
                  <label class="toggle-row toggle-row--compact">
                    <span>
                      <strong>删除已保存的 Key</strong>
                      <small>删除后行内 AI 与 Agent 会停止工作，直到重新配置。</small>
                    </span>
                    <input v-model="removeKey" type="checkbox" />
                  </label>

                  <div class="provider-actions">
                    <button class="btn btn--primary btn--small" :disabled="savingProvider" @click="saveProvider">
                      <Loader2 v-if="savingProvider" :size="13" class="spin" />
                      <Check v-else :size="13" />
                      保存配置
                    </button>
                    <button class="btn btn--small" :disabled="testing || !provider?.hasApiKey || !!provider?.credentialError" @click="testConnection">
                      <Loader2 v-if="testing" :size="13" class="spin" />
                      {{ testing ? '测试中…' : '测试连接' }}
                    </button>
                  </div>
                  <p v-if="testResult" class="settings-success">{{ testResult }}</p>
                  <p v-if="testError" class="settings-error">{{ testError }}</p>
                </section>
              </template>

              <template v-else>
                <section class="settings-section">
                  <h3>本地数据</h3>
                  <p class="settings-help">
                    你的 Markdown 源文件始终留在原目录。Vesrio 只在本机的应用数据目录保存元数据、对话与快照。
                  </p>
                  <dl class="path-list">
                    <div>
                      <dt>应用数据</dt>
                      <dd>{{ paths.dataDir ?? appInfo?.dataDir ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt>数据库</dt>
                      <dd>{{ paths.database ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt>快照目录</dt>
                      <dd>{{ paths.snapshotRoot ?? '—' }}</dd>
                    </div>
                    <div>
                      <dt>日志</dt>
                      <dd>{{ appInfo?.logPath ?? '—' }}</dd>
                    </div>
                  </dl>
                  <p class="settings-help">
                    日志包含事件、错误码与请求 ID，不记录正文、API Key 或完整提示词。
                  </p>
                </section>
                <section class="settings-section">
                  <h3>版本</h3>
                  <p class="settings-help">
                    {{ appInfo?.name ?? 'Vesrio' }} {{ appInfo?.version ?? '0.1.0' }} ·
                    {{ appInfo?.platform ?? 'unknown' }} ·
                    <kbd>{{ shortcutModifier(appInfo?.platform) }}</kbd> + <kbd>/</kbd> 查看快捷键
                  </p>
                </section>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
