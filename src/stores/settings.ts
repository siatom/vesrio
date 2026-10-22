import { defineStore } from 'pinia'
import { api, hasBackend } from '@/lib/api'
import { normalizeError } from '@/lib/errors'
import { DEFAULT_SETTINGS, type AppSettings, type Theme } from '@/lib/types'

const FONT_STACKS: Record<AppSettings['editorFont'], string> = {
  serif: '"Source Han Serif SC", "Noto Serif SC", "Songti SC", SimSun, Georgia, serif',
  sans: '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace',
}

function coerce(raw: Record<string, unknown>): Partial<AppSettings> {
  const patch: Partial<AppSettings> = {}
  const pick = <K extends keyof AppSettings>(key: K, check: (value: unknown) => boolean) => {
    if (check(raw[key])) patch[key] = raw[key] as AppSettings[K]
  }
  pick('theme', (v) => v === 'system' || v === 'light' || v === 'dark')
  pick('editorFont', (v) => v === 'serif' || v === 'sans' || v === 'mono')
  pick('fontSize', (v) => typeof v === 'number' && v >= 12 && v <= 28)
  pick('lineHeight', (v) => typeof v === 'number' && v >= 1.2 && v <= 2.2)
  pick('editorWidth', (v) => typeof v === 'number' && v >= 420 && v <= 1400)
  pick('focusMode', (v) => typeof v === 'boolean')
  pick('reviewMode', (v) => typeof v === 'boolean')
  pick('confirmBeforeSend', (v) => typeof v === 'boolean')
  pick('autoSnapshot', (v) => typeof v === 'boolean')
  pick('typewriterMode', (v) => typeof v === 'boolean')
  pick('sidebarOpen', (v) => typeof v === 'boolean')
  pick('outlineOpen', (v) => typeof v === 'boolean')
  pick('inspectorOpen', (v) => typeof v === 'boolean')
  pick('inspectorTab', (v) => v === 'outline' || v === 'agent' || v === 'revisions')
  pick('lastFolder', (v) => typeof v === 'string')
  pick('lastDocument', (v) => typeof v === 'string')
  return patch
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    ...DEFAULT_SETTINGS,
    loaded: false,
    systemDark: false,
    lastError: '',
  }),
  getters: {
    resolvedTheme(state): 'light' | 'dark' {
      if (state.theme === 'system') return state.systemDark ? 'dark' : 'light'
      return state.theme
    },
  },
  actions: {
    async load() {
      if (hasBackend()) {
        try {
          const raw = await api.getSettings()
          Object.assign(this, coerce(raw))
        } catch (error) {
          this.lastError = normalizeError(error).message
        }
      }
      this.loaded = true
      this.applyTheme()
    },
    watchSystemTheme() {
      if (typeof window === 'undefined' || !window.matchMedia) return
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      this.systemDark = query.matches
      query.addEventListener('change', (event) => {
        this.systemDark = event.matches
        this.applyTheme()
      })
      this.applyTheme()
    },
    applyTheme() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      root.dataset.theme = this.resolvedTheme
      root.style.setProperty('--editor-font-size', `${this.fontSize}px`)
      root.style.setProperty('--editor-line-height', String(this.lineHeight))
      root.style.setProperty('--editor-measure', `${this.editorWidth}px`)
      root.style.setProperty('--editor-font-family', FONT_STACKS[this.editorFont])
    },
    async update(patch: Partial<AppSettings>) {
      Object.assign(this, patch)
      this.applyTheme()
      if (!hasBackend()) return
      const allowed = coerce(patch as Record<string, unknown>)
      try {
        await api.setSettings(allowed)
      } catch (error) {
        this.lastError = normalizeError(error).message
        throw error
      }
    },
    async setTheme(theme: Theme) {
      await this.update({ theme })
    },
    async toggleTheme() {
      const next = this.resolvedTheme === 'dark' ? 'light' : 'dark'
      await this.update({ theme: next })
    },
    async toggleFocusMode() {
      await this.update({ focusMode: !this.focusMode })
    },
    async toggleReviewMode() {
      await this.update({ reviewMode: !this.reviewMode })
    },
  },
})
