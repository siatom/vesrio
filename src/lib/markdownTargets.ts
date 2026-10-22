/**
 * Markdown link/image target resolution.
 *
 * Markdown stores link and image destinations as-is. Resolving them must not
 * change the source text: the same helpers are used only for the live preview
 * and for explicit click actions.
 */

export type MarkdownTarget =
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string; fragment: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'data'; url: string }
  | { kind: 'invalid'; reason: string }

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
const URI_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function splitSuffix(raw: string): { path: string; query: string; fragment: string } {
  let rest = raw
  let fragment = ''
  const hash = rest.indexOf('#')
  if (hash >= 0) {
    fragment = rest.slice(hash + 1)
    rest = rest.slice(0, hash)
  }
  let query = ''
  const question = rest.indexOf('?')
  if (question >= 0) {
    query = rest.slice(question + 1)
    rest = rest.slice(0, question)
  }
  return { path: rest, query, fragment }
}

function separatorFor(path: string): '/' | '\\' {
  return path.includes('\\') || WINDOWS_DRIVE.test(path) ? '\\' : '/'
}

function dirname(path: string): string {
  const sep = separatorFor(path)
  const normalized = path.replace(/[\\/]+/g, sep)
  const index = normalized.lastIndexOf(sep)
  if (index < 0) return ''
  if (index === 0) return sep
  const head = normalized.slice(0, index)
  return WINDOWS_DRIVE.test(head) && head.length === 2 ? `${head}${sep}` : head
}

function driveRoot(path: string): string | null {
  const match = /^([a-zA-Z]:)[\\/]/.exec(path)
  if (match) return `${match[1]}\\`
  if (path.startsWith('\\\\')) return null
  return null
}

function isAbsolutePath(path: string): boolean {
  return WINDOWS_DRIVE.test(path) || path.startsWith('/') || path.startsWith('\\')
}

/** Join a relative Markdown destination onto the document's directory. */
export function resolveRelativePath(relative: string, documentPath: string): string {
  const sep = separatorFor(documentPath)
  const target = relative.replace(/[\\/]+/g, sep)
  if (isAbsolutePath(target)) {
    if (WINDOWS_DRIVE.test(target) || target.startsWith('\\\\')) return normalizePath(target, sep)
    const root = driveRoot(documentPath)
    if (root) return normalizePath(`${root}${target.replace(/^[\\/]+/, '')}`, sep)
    return normalizePath(target, sep)
  }

  const base = dirname(documentPath)
  const prefix = base && !base.endsWith(sep) ? `${base}${sep}` : base
  return normalizePath(`${prefix}${target}`, sep)
}

function normalizePath(path: string, sep: '/' | '\\'): string {
  const drive = /^([a-zA-Z]:)/.exec(path)?.[1] ?? ''
  let rest = path.slice(drive.length)
  let prefix = drive ? `${drive}${sep}` : ''

  if (rest.startsWith('\\\\') || rest.startsWith('//')) {
    prefix = '\\\\'
    rest = rest.slice(2)
  } else if (rest.startsWith('/') || rest.startsWith('\\')) {
    if (!drive) prefix = sep
    rest = rest.replace(/^[\\/]+/, '')
  }

  const stack: string[] = []
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  const joined = stack.join(sep)
  if (!joined) return prefix || '.'
  return `${prefix}${joined}`
}

function fileUrlPath(raw: string): string {
  let value = raw.slice(5)
  if (value.startsWith('//')) {
    value = value.slice(2)
    if (/^[a-zA-Z]:/.test(value)) {
      // file://C:/path (non-standard but seen in the wild)
    } else if (value.startsWith('/')) {
      // file:///C:/path -> /C:/path; the drive slash is removed below.
    } else {
      // file://server/share/path -> UNC path
      value = `\\\\${value}`
    }
  }
  if (/^\/[a-zA-Z]:/.test(value)) value = value.slice(1)
  return value
}

function fileTarget(raw: string, fragment: string): MarkdownTarget {
  const path = decode(fileUrlPath(raw))
  if (!path) return { kind: 'invalid', reason: '链接路径为空' }
  return { kind: 'file', path: normalizePath(path, separatorFor(path)), fragment }
}

/**
 * Resolve a Markdown destination relative to the open document without touching
 * the document itself. Unknown schemes (notably `javascript:`) are rejected.
 */
export function resolveMarkdownTarget(raw: string, documentPath: string): MarkdownTarget {
  let value = raw.trim()
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim()
  if (!value) return { kind: 'invalid', reason: '链接为空' }

  const { path, fragment } = splitSuffix(value)

  if (value.startsWith('#') || (!path && fragment)) {
    return { kind: 'anchor', anchor: decode(fragment) }
  }

  // Protocol-relative URLs are web links, not Windows UNC paths.
  if (value.startsWith('//')) {
    return { kind: 'external', url: `https:${value}` }
  }

  if (WINDOWS_DRIVE.test(value) || value.startsWith('\\\\')) {
    return { kind: 'file', path: normalizePath(decode(path), '\\'), fragment }
  }

  const scheme = URI_SCHEME.exec(path)
  if (scheme) {
    const name = (scheme[1] ?? '').toLowerCase()
    switch (name) {
      case 'http':
      case 'https':
      case 'mailto':
      case 'tel':
        return { kind: 'external', url: value }
      case 'file':
        return fileTarget(path, fragment)
      case 'data':
        return { kind: 'data', url: value }
      default:
        return { kind: 'invalid', reason: `不支持的链接协议：${name}` }
    }
  }

  const relative = decode(path)
  if (!relative) {
    return { kind: 'invalid', reason: '链接路径为空' }
  }
  const resolved = resolveRelativePath(relative, documentPath)
  return { kind: 'file', path: resolved, fragment }
}

/** Path portion of a file target, useful for extension checks and opening. */
export function fileExtension(path: string): string {
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase()
}

export interface InlineLinkParts {
  /** Visible label for a link, alt text for an image. */
  label: string
  destination: string
  title: string
  image: boolean
}

function findClosing(value: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let index = start; index < value.length; index += 1) {
    const char = value[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return -1
}

/** Parse `[label](destination "title")` or `![alt](destination)`. */
export function parseInlineLink(value: string): InlineLinkParts | null {
  const image = value.startsWith('!')
  const labelOpen = image ? 2 : 1
  if (value[image ? 1 : 0] !== '[') return null
  const labelClose = findClosing(value, labelOpen, '[', ']')
  if (labelClose < 0 || value[labelClose + 1] !== '(') return null
  const destinationEnd = findClosing(value, labelClose + 2, '(', ')')
  if (destinationEnd !== value.length - 1) return null

  const body = value.slice(labelClose + 2, destinationEnd).trim()
  let destination = ''
  let title = ''
  if (body.startsWith('<')) {
    const close = findClosing(body, 1, '<', '>')
    if (close < 0) return null
    destination = body.slice(1, close)
    title = parseTitle(body.slice(close + 1).trim())
  } else {
    const match = /^(\S+)(?:\s+(.+))?$/.exec(body)
    if (!match) return null
    destination = match[1] ?? ''
    title = parseTitle((match[2] ?? '').trim())
  }
  if (!destination) return null
  return { label: value.slice(labelOpen, labelClose), destination, title, image }
}

function parseTitle(raw: string): string {
  if (!raw) return ''
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1)
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) return raw.slice(1, -1)
  if (raw.startsWith('(') && raw.endsWith(')') && raw.length >= 2) return raw.slice(1, -1)
  return ''
}

/** Parse autolinks such as `<https://example.com>` or `<hi@example.com>`. */
export function parseAutolink(value: string): string | null {
  if (!value.startsWith('<') || !value.endsWith('>')) return null
  const inner = value.slice(1, -1).trim()
  if (URI_SCHEME.test(inner)) return inner
  return inner.includes('@') ? `mailto:${inner}` : null
}

export function linkDefinitionKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Collect `[label]: destination` definitions, which reference links reuse. */
export function collectLinkDefinitions(text: string): Map<string, string> {
  const definitions = new Map<string, string>()
  const pattern = /^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm
  for (const match of text.matchAll(pattern)) {
    const label = match[1]
    const destination = match[2] ?? match[3]
    if (!label || !destination) continue
    const key = linkDefinitionKey(label)
    if (!definitions.has(key)) definitions.set(key, destination)
  }
  return definitions
}

/** Resolve a reference-style link/image label through the document definitions. */
export function referenceDestination(
  value: string,
  definitions: Map<string, string>,
): string | null {
  const image = value.startsWith('!')
  const open = image ? 2 : 1
  if (value[image ? 1 : 0] !== '[') return null
  const close = findClosing(value, open, '[', ']')
  if (close < 0) return null
  const label = value.slice(open, close)
  const after = value.slice(close + 1)
  if (after.startsWith('[')) {
    const end = findClosing(after, 1, '[', ']')
    if (end !== after.length - 1) return null
    const reference = after.slice(1, end) || label
    return definitions.get(linkDefinitionKey(reference)) ?? null
  }
  if (after === '') return definitions.get(linkDefinitionKey(label)) ?? null
  return null
}
