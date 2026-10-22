import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  detectedEncoding,
  friendlyMessage,
  isUnsupportedEncoding,
} from '@/lib/errors'

export async function openFile(path: string): Promise<void> {
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  try {
    await workspace.openFilePath(path)
  } catch (error) {
    if (isUnsupportedEncoding(error)) {
      ui.encodingPrompt = {
        path,
        encoding: detectedEncoding(error) ?? 'unknown',
      }
      return
    }
    ui.error('打开文件失败', friendlyMessage(error))
  }
}

export async function openFolder(path?: string): Promise<void> {
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  try {
    const selected = path ?? (await workspace.pickFolder())
    if (!selected) return
    if (path) await workspace.loadProject(path)
    ui.success(`已打开文件夹「${workspace.project?.name ?? ''}」`)
  } catch (error) {
    ui.error('打开文件夹失败', friendlyMessage(error))
  }
}

export async function openWithEncoding(path: string, encoding: string): Promise<boolean> {
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  try {
    await workspace.openFilePath(path, encoding)
    ui.success(`已用 ${encoding.toUpperCase()} 打开文档`, '原文件在你保存前不会被改写')
    return true
  } catch (error) {
    ui.error('转换编码失败', friendlyMessage(error))
    return false
  }
}
