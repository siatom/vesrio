import { describe, expect, it } from 'vitest'
import { platformFamily, shortcutModifier } from '@/lib/platform'

describe('platform helpers', () => {
  it('parses the platform labels returned by Rust', () => {
    expect(platformFamily('windows-x86_64')).toBe('windows')
    expect(platformFamily('win32-x64')).toBe('windows')
    expect(platformFamily('macos-aarch64')).toBe('macos')
    expect(platformFamily('darwin-x86_64')).toBe('macos')
    expect(platformFamily('linux-x86_64')).toBe('linux')
    expect(platformFamily('freebsd-x86_64')).toBe('unknown')
    expect(platformFamily('')).toBe('unknown')
    expect(platformFamily(null)).toBe('unknown')
    expect(platformFamily(undefined)).toBe('unknown')
  })

  it('shows the Command key only on macOS', () => {
    expect(shortcutModifier('macos-aarch64')).toBe('⌘')
    expect(shortcutModifier('macos-x86_64')).toBe('⌘')
    expect(shortcutModifier('windows-x86_64')).toBe('Ctrl')
    expect(shortcutModifier('linux-x86_64')).toBe('Ctrl')
    expect(shortcutModifier('')).toBe('Ctrl')
  })
})
