import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { friendlyMessage } from '@/lib/errors'
import type { StyleProfile, StyleRules } from '@/lib/types'
import { useUiStore } from './ui'

export function emptyRules(): StyleRules {
  return {
    audience: '',
    tone: '',
    terminology: [],
    banned: [],
    notes: '',
  }
}

export const useStyleStore = defineStore('style', {
  state: () => ({
    projectId: null as string | null,
    profile: null as StyleProfile | null,
    rules: emptyRules(),
    loading: false,
    saving: false,
    error: '',
  }),
  getters: {
    hasStyle(state): boolean {
      const rules = state.rules
      return Boolean(
        rules.audience.trim() ||
          rules.tone.trim() ||
          rules.notes.trim() ||
          rules.banned.length ||
          rules.terminology.length,
      )
    },
    versionLabel(state): string {
      return state.profile ? `v${state.profile.version}` : '未保存'
    },
  },
  actions: {
    async load(projectId: string | null) {
      if (!projectId) {
        this.projectId = null
        this.profile = null
        this.rules = emptyRules()
        return
      }
      this.projectId = projectId
      this.loading = true
      this.error = ''
      try {
        const profile = await api.getStyleProfile(projectId)
        this.profile = profile
        this.rules = { ...emptyRules(), ...profile.rules }
      } catch (error) {
        this.error = friendlyMessage(error)
      } finally {
        this.loading = false
      }
    },
    async save() {
      if (!this.projectId) {
        useUiStore().warn('请先打开一个文件夹项目')
        return null
      }
      this.saving = true
      this.error = ''
      try {
        const profile = await api.saveStyleProfile(this.projectId, this.rules)
        this.profile = profile
        this.rules = { ...emptyRules(), ...profile.rules }
        useUiStore().success(`风格卡已保存（v${profile.version}）`)
        return profile
      } catch (error) {
        this.error = friendlyMessage(error)
        useUiStore().error('保存风格卡失败', this.error)
        return null
      } finally {
        this.saving = false
      }
    },
  },
})
