import type { AppErrorPayload } from './types'

export function normalizeError(error: unknown): AppErrorPayload {
  if (error && typeof error === 'object') {
    const candidate = error as Partial<AppErrorPayload>
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        message: candidate.message,
        retryable: candidate.retryable ?? false,
        details: candidate.details,
      }
    }
    if (error instanceof Error) {
      return { code: 'unknown', message: error.message, retryable: false }
    }
  }
  return { code: 'unknown', message: String(error), retryable: false }
}

const MESSAGES: Record<string, string> = {
  external_conflict: '文件已在磁盘上发生变化，未自动覆盖。',
  unsupported_encoding: '文件不是 UTF-8 编码，需要你确认是否转换。',
  unsupported_document_type: '仅支持 Markdown 与纯文本文件。',
  not_found: '找不到目标文件或记录。',
  permission_denied: '没有访问权限。',
  unsafe_path: '路径不安全，操作已被拒绝。',
  storage_error: '本地数据读写失败。',
  invalid_input: '输入不合法。',
  provider_error: '模型服务请求失败。',
  not_configured: '尚未配置模型服务或 API Key。',
  cancelled: '已取消。',
  stale_suggestion: '原文已变化，旧建议不能应用。',
  invalid_transition: '当前状态不允许该操作。',
  desktop_only: '此功能需要在桌面应用中使用。',
}

export function friendlyMessage(error: unknown): string {
  const payload = normalizeError(error)
  return MESSAGES[payload.code] ?? payload.message
}

export function isConflict(error: unknown): boolean {
  return normalizeError(error).code === 'external_conflict'
}

export function isUnsupportedEncoding(error: unknown): boolean {
  return normalizeError(error).code === 'unsupported_encoding'
}

export function detectedEncoding(error: unknown): string | null {
  const details = normalizeError(error).details
  const value = details?.encoding
  return typeof value === 'string' ? value : null
}

export function conflictHashes(error: unknown): { diskHash?: string; expectedHash?: string } {
  const details = normalizeError(error).details
  return {
    diskHash: typeof details?.diskHash === 'string' ? details.diskHash : undefined,
    expectedHash: typeof details?.expectedHash === 'string' ? details.expectedHash : undefined,
  }
}
