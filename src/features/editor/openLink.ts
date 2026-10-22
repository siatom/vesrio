import { openUrl } from '@tauri-apps/plugin-opener'
import { isTauri } from '@/lib/api'
import { friendlyMessage } from '@/lib/errors'
import { fileExtension, resolveMarkdownTarget } from '@/lib/markdownTargets'
import { findHeadingOffset } from '@/lib/outline'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { getEditor } from './editorRegistry'

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd'])

/**
 * Open an explicit link action from the live preview.
 *
 * Only web/mail links and Markdown documents are followed. Local attachments
 * and unknown schemes stay inert so a crafted document cannot launch arbitrary
 * programs on click. Opening is always triggered by a user gesture.
 */
export async function openMarkdownLink(href: string, documentPath: string): Promise<void> {
  const target = resolveMarkdownTarget(href, documentPath)
  const ui = useUiStore()

  if (target.kind === 'invalid') {
    ui.warn('无法打开链接', target.reason)
    return
  }
  if (target.kind === 'anchor' || target.kind === 'data') return

  try {
    if (target.kind === 'external') {
      if (isTauri()) await openUrl(target.url)
      else window.open(target.url, '_blank', 'noopener,noreferrer')
      return
    }

    const extension = fileExtension(target.path)
    if (MARKDOWN_EXTENSIONS.has(extension)) {
      const workspace = useWorkspaceStore()
      const opened = await workspace.openFilePath(target.path)
      if (opened && target.fragment) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        const offset = findHeadingOffset(opened.text, target.fragment)
        if (offset != null) getEditor(opened.id)?.scrollToPos(offset)
      }
      return
    }
    ui.warn('暂不支持打开此外部文件', target.path)
  } catch (error) {
    ui.error('打开链接失败', friendlyMessage(error))
  }
}
