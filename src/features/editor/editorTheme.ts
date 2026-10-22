import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontSize: 'var(--editor-font-size)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font-family)',
    lineHeight: 'var(--editor-line-height)',
    padding: '44px 0 32vh',
    overflow: 'auto',
  },
  '.cm-content': {
    maxWidth: 'var(--editor-measure)',
    margin: '0 auto',
    padding: '0 52px',
    caretColor: 'var(--accent)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--editor-active-line)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--search-match)',
    outline: '1px solid var(--search-match-border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
  },
  '.cm-panel.cm-search': {
    padding: '8px 12px',
  },
  '.cm-panel.cm-search input': {
    backgroundColor: 'var(--input-bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '4px 8px',
    outline: 'none',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '3px 9px',
    cursor: 'pointer',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-md)',
  },
  '.cm-md-heading': {
    fontWeight: '700',
    letterSpacing: '-0.01em',
  },
  '.cm-md-h1': { fontSize: '1.7em', lineHeight: '1.35' },
  '.cm-md-h2': { fontSize: '1.38em', lineHeight: '1.45' },
  '.cm-md-h3': { fontSize: '1.16em' },
  '.cm-md-h4': { fontSize: '1.05em' },
  '.cm-md-h5': { fontSize: '1em' },
  '.cm-md-h6': { fontSize: '0.94em', color: 'var(--text-muted)' },
  '.cm-md-inline-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    backgroundColor: 'var(--code-bg)',
    borderRadius: '4px',
    padding: '0.06em 0.28em',
  },
  '.cm-md-link': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent-soft)',
    textUnderlineOffset: '3px',
  },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--accent-soft)',
    paddingLeft: '18px',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  '.cm-md-list-mark': {
    color: 'var(--accent)',
  },
  '.cm-md-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    backgroundColor: 'var(--code-bg)',
  },
  '.cm-md-table': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
  },
  '.cm-md-rule': {
    color: 'var(--text-faint)',
  },
  '.cm-md-html': {
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-muted)',
  },
})

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-faint)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  { tag: tags.quote, color: 'var(--text-muted)' },
  { tag: tags.list, color: 'var(--text)' },
  { tag: tags.contentSeparator, color: 'var(--text-faint)' },
  { tag: tags.processingInstruction, color: 'var(--text-faint)' },
  { tag: tags.meta, color: 'var(--text-faint)' },
])

export const editorHighlighting = syntaxHighlighting(highlight)
