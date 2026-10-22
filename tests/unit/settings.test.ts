import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/lib/api', () => ({
  isTauri: () => true,
  hasBackend: () => true,
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    setSettings: vi.fn().mockResolvedValue({}),
  },
}))

import { useSettingsStore } from '@/stores/settings'

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.documentElement.removeAttribute('data-theme')
  })

  it('applies the resolved theme to the document root', async () => {
    const settings = useSettingsStore()
    await settings.load()
    await settings.update({ theme: 'dark' })
    expect(settings.resolvedTheme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('follows the system theme when set to system', async () => {
    const settings = useSettingsStore()
    await settings.load()
    settings.theme = 'system'
    settings.systemDark = true
    settings.applyTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('writes editor typography to CSS variables', async () => {
    const settings = useSettingsStore()
    await settings.load()
    await settings.update({ fontSize: 19, lineHeight: 1.9, editorWidth: 760 })
    const style = document.documentElement.style
    expect(style.getPropertyValue('--editor-font-size')).toBe('19px')
    expect(style.getPropertyValue('--editor-line-height')).toBe('1.9')
    expect(style.getPropertyValue('--editor-measure')).toBe('760px')
  })

  it('clamps persisted values through the whitelist', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.getSettings).mockResolvedValue({
      theme: 'neon',
      fontSize: 99,
      editorFont: 'mono',
    })
    const settings = useSettingsStore()
    await settings.load()
    expect(settings.theme).toBe('system')
    expect(settings.fontSize).toBe(17)
    expect(settings.editorFont).toBe('mono')
  })
})
