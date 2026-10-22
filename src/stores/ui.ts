import { defineStore } from 'pinia'
import type { Toast } from '@/lib/types'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

interface ChoiceOptions {
  title: string
  message: string
  primary: string
  secondary: string
  danger?: boolean
}

interface ChoiceState extends ChoiceOptions {
  resolve: (value: 'primary' | 'secondary' | 'cancel') => void
}

let toastId = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    paletteOpen: false,
    settingsOpen: false,
    shortcutsOpen: false,
    styleOpen: false,
    privacyOpen: false,
    newDocumentOpen: false,
    confirm: null as ConfirmState | null,
    choice: null as ChoiceState | null,
    encodingPrompt: null as { path: string; encoding: string } | null,
    inlineAiOpen: false,
  }),
  actions: {
    toast(kind: Toast['kind'], message: string, detail?: string) {
      const id = ++toastId
      this.toasts.push({ id, kind, message, detail })
      window.setTimeout(() => this.dismissToast(id), kind === 'error' ? 8000 : 4200)
      return id
    },
    success(message: string, detail?: string) {
      return this.toast('success', message, detail)
    },
    warn(message: string, detail?: string) {
      return this.toast('warn', message, detail)
    },
    error(message: string, detail?: string) {
      return this.toast('error', message, detail)
    },
    dismissToast(id: number) {
      this.toasts = this.toasts.filter((toast) => toast.id !== id)
    },
    askConfirm(options: ConfirmOptions): Promise<boolean> {
      return new Promise((resolve) => {
        this.confirm = { ...options, resolve }
      })
    },
    resolveConfirm(value: boolean) {
      const pending = this.confirm
      this.confirm = null
      pending?.resolve(value)
    },
    askChoice(options: ChoiceOptions): Promise<'primary' | 'secondary' | 'cancel'> {
      return new Promise((resolve) => {
        this.choice = { ...options, resolve }
      })
    },
    resolveChoice(value: 'primary' | 'secondary' | 'cancel') {
      const pending = this.choice
      this.choice = null
      pending?.resolve(value)
    },
  },
})
