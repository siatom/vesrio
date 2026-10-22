/**
 * Platform helpers shared by UI code.
 *
 * The platform label comes from the Rust `get_app_info` command. Do not sniff
 * the user agent: the WebView version differs per platform and the backend is
 * the source of truth.
 */

export type PlatformFamily = 'windows' | 'macos' | 'linux' | 'unknown'

/** Normalize `windows-x86_64`, `macos-aarch64`, legacy `win32-x64`, etc. */
export function platformFamily(label: string | null | undefined): PlatformFamily {
  const value = (label ?? '').trim().toLowerCase()
  if (!value) return 'unknown'

  switch (value.split('-')[0]) {
    case 'windows':
    case 'win32':
      return 'windows'
    case 'macos':
    case 'darwin':
    case 'mac':
      return 'macos'
    case 'linux':
      return 'linux'
    default:
      return 'unknown'
  }
}

/** Label for the primary shortcut modifier shown in UI hints. */
export function shortcutModifier(label: string | null | undefined): '⌘' | 'Ctrl' {
  return platformFamily(label) === 'macos' ? '⌘' : 'Ctrl'
}
