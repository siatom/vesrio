import { describe, expect, it } from 'vitest'
import {
  collectLinkDefinitions,
  fileExtension,
  parseAutolink,
  parseInlineLink,
  referenceDestination,
  resolveMarkdownTarget,
  resolveRelativePath,
} from '@/lib/markdownTargets'

describe('resolveRelativePath', () => {
  it('joins relative paths on Windows', () => {
    expect(resolveRelativePath('images/cover.png', 'C:\\docs\\notes\\post.md')).toBe(
      'C:\\docs\\notes\\images\\cover.png',
    )
    expect(resolveRelativePath('../assets/cover.png', 'C:\\docs\\notes\\post.md')).toBe(
      'C:\\docs\\assets\\cover.png',
    )
    expect(resolveRelativePath('./a/../b.png', 'C:\\docs\\post.md')).toBe('C:\\docs\\b.png')
  })

  it('joins relative paths on Unix without mixing separators', () => {
    expect(resolveRelativePath('images/cover.png', '/home/me/docs/post.md')).toBe(
      '/home/me/docs/images/cover.png',
    )
    expect(resolveRelativePath('../cover.png', '/home/me/docs/post.md')).toBe('/home/me/cover.png')
  })

  it('keeps drive-rooted and absolute paths absolute', () => {
    expect(resolveRelativePath('/images/a.png', 'C:\\docs\\post.md')).toBe('C:\\images\\a.png')
    expect(resolveRelativePath('D:\\pics\\a.png', 'C:\\docs\\post.md')).toBe('D:\\pics\\a.png')
    expect(resolveRelativePath('/images/a.png', '/home/me/post.md')).toBe('/images/a.png')
  })
})

describe('resolveMarkdownTarget', () => {
  const documentPath = 'C:\\docs\\notes\\post.md'

  it('recognizes safe external links', () => {
    expect(resolveMarkdownTarget('https://example.com/a?q=1#top', documentPath)).toEqual({
      kind: 'external',
      url: 'https://example.com/a?q=1#top',
    })
    expect(resolveMarkdownTarget('mailto:hi@example.com', documentPath)).toEqual({
      kind: 'external',
      url: 'mailto:hi@example.com',
    })
  })

  it('rejects executable and unknown schemes', () => {
    expect(resolveMarkdownTarget('javascript:alert(1)', documentPath).kind).toBe('invalid')
    expect(resolveMarkdownTarget('vbscript:msgbox(1)', documentPath).kind).toBe('invalid')
    expect(resolveMarkdownTarget('custom:thing', documentPath).kind).toBe('invalid')
  })

  it('resolves relative images and keeps fragments', () => {
    expect(resolveMarkdownTarget('../assets/cover.png', documentPath)).toEqual({
      kind: 'file',
      path: 'C:\\docs\\assets\\cover.png',
      fragment: '',
    })
    expect(resolveMarkdownTarget('other.md#小节', documentPath)).toEqual({
      kind: 'file',
      path: 'C:\\docs\\notes\\other.md',
      fragment: '小节',
    })
  })

  it('decodes percent-encoded path segments', () => {
    expect(resolveMarkdownTarget('images/a%20b.png', documentPath)).toEqual({
      kind: 'file',
      path: 'C:\\docs\\notes\\images\\a b.png',
      fragment: '',
    })
  })

  it('handles file URLs and anchors', () => {
    expect(resolveMarkdownTarget('file:///C:/pics/a.png', documentPath)).toEqual({
      kind: 'file',
      path: 'C:\\pics\\a.png',
      fragment: '',
    })
    expect(resolveMarkdownTarget('#第一章', documentPath)).toEqual({
      kind: 'anchor',
      anchor: '第一章',
    })
    expect(resolveMarkdownTarget('', documentPath).kind).toBe('invalid')
  })

  it('treats protocol-relative URLs as web links', () => {
    expect(resolveMarkdownTarget('//example.com/a.png', documentPath)).toEqual({
      kind: 'external',
      url: 'https://example.com/a.png',
    })
  })

  it('accepts data images but not other data links as files', () => {
    expect(resolveMarkdownTarget('data:image/png;base64,AAAA', documentPath)).toEqual({
      kind: 'data',
      url: 'data:image/png;base64,AAAA',
    })
  })
})

describe('inline Markdown parsing', () => {
  it('parses inline links with optional titles', () => {
    expect(parseInlineLink('[Example](https://example.com "Title")')).toEqual({
      label: 'Example',
      destination: 'https://example.com',
      title: 'Title',
      image: false,
    })
    expect(parseInlineLink('[A](<a b.md>)')).toMatchObject({
      destination: 'a b.md',
      title: '',
    })
  })

  it('parses images and rejects malformed syntax', () => {
    expect(parseInlineLink('![cover](../assets/cover.png)')).toEqual({
      label: 'cover',
      destination: '../assets/cover.png',
      title: '',
      image: true,
    })
    expect(parseInlineLink('[broken](url')).toBeNull()
    expect(parseInlineLink('[text][ref]')).toBeNull()
  })

  it('parses autolinks', () => {
    expect(parseAutolink('<https://example.com>')).toBe('https://example.com')
    expect(parseAutolink('<hi@example.com>')).toBe('mailto:hi@example.com')
    expect(parseAutolink('<not a url>')).toBeNull()
  })

  it('resolves reference links through definitions', () => {
    const definitions = collectLinkDefinitions(
      '[ref]: https://example.com\n[Ref]: ./other.md\n[img]: ../a.png\n',
    )
    expect(definitions.get('ref')).toBe('https://example.com')
    expect(referenceDestination('[text][ref]', definitions)).toBe('https://example.com')
    expect(referenceDestination('[text][]', definitions)).toBeNull()
    expect(referenceDestination('[ref]', definitions)).toBe('https://example.com')
    expect(referenceDestination('![img][img]', definitions)).toBe('../a.png')
  })
})

describe('fileExtension', () => {
  it('returns a lowercase extension', () => {
    expect(fileExtension('C:\\docs\\Note.MD')).toBe('md')
    expect(fileExtension('/home/me/note.markdown')).toBe('markdown')
    expect(fileExtension('C:\\docs\\README')).toBe('')
  })
})
