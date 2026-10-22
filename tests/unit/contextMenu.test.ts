import { afterEach, describe, expect, it } from 'vitest'
import { suppressNativeContextMenu } from '@/lib/contextMenu'

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.innerHTML = ''
})

function rightClick(target: EventTarget): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('suppressNativeContextMenu', () => {
  it('prevents the native context menu', () => {
    dispose = suppressNativeContextMenu()

    expect(rightClick(window).defaultPrevented).toBe(true)
  })

  it('restores the native menu after disposal', () => {
    dispose = suppressNativeContextMenu()
    dispose()
    dispose = undefined

    expect(rightClick(window).defaultPrevented).toBe(false)
  })

  it('still guards events when an inner handler stops propagation', () => {
    const inner = document.createElement('div')
    inner.addEventListener('contextmenu', (event) => event.stopPropagation())
    document.body.append(inner)
    dispose = suppressNativeContextMenu()

    expect(rightClick(inner).defaultPrevented).toBe(true)
  })
})
