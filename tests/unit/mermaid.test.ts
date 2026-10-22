import { describe, expect, it } from 'vitest'
import { scanMermaidBlocks } from '@/features/editor/mermaid'

describe('scanMermaidBlocks', () => {
  it('finds backtick fenced mermaid blocks with full-line offsets', () => {
    const text = '前言\n\n```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```\n\n后文'
    const blocks = scanMermaidBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.code).toBe('graph TD\n  A[开始] --> B[结束]')
    expect(text.slice(blocks[0]?.from, blocks[0]?.to)).toBe(
      '```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```',
    )
  })

  it('supports tilde fences, uppercase info strings, and extra info words', () => {
    const text = '~~~Mermaid title="流程"\nflowchart LR\n  A --> B\n~~~~'
    const blocks = scanMermaidBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.code).toBe('flowchart LR\n  A --> B')
  })

  it('ignores other fences and mermaid text outside fences', () => {
    const text = 'mermaid outside\n\n```ts\nconst x = 1\n```\n\n```mermaid\ngraph TD\nA-->B\n```'
    const blocks = scanMermaidBlocks(text)
    expect(blocks.map((block) => block.code)).toEqual(['graph TD\nA-->B'])
  })

  it('ignores unclosed fences and empty diagrams', () => {
    expect(scanMermaidBlocks('```mermaid\ngraph TD\nA-->B')).toEqual([])
    expect(scanMermaidBlocks('```mermaid\n\n```')).toEqual([])
  })

  it('treats a longer closing fence as valid', () => {
    const text = '```mermaid\ngraph TD\nA-->B\n`````'
    expect(scanMermaidBlocks(text)).toHaveLength(1)
  })
})
