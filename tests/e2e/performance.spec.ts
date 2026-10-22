import { expect, test } from '@playwright/test'
import { bootApp } from './helpers'

test('50k-character document stays responsive for insert and scroll', async ({ page }) => {
  await bootApp(page)
  const metrics = await page.evaluate(async () => {
    const editor = (window as unknown as {
      __vesrioEditor?: {
        replaceAll: (text: string) => void
        scrollToPos: (pos: number) => void
        getText: () => string
      }
    }).__vesrioEditor
    if (!editor) throw new Error('editor test hook missing')

    const paragraph = '构建适配需要对原有软件进行一定程度的调整，并保留条件性表述。\n\n'
    const text = paragraph.repeat(Math.ceil(50_000 / paragraph.length)).slice(0, 50_000)

    const insertStart = performance.now()
    editor.replaceAll(text)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const insertMs = performance.now() - insertStart

    const scrollStart = performance.now()
    for (let index = 0; index <= 40; index += 1) {
      editor.scrollToPos(Math.floor((text.length * index) / 40))
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const scrollMs = performance.now() - scrollStart

    return { length: editor.getText().length, insertMs, scrollMs }
  })

  test.info().annotations.push({
    type: 'performance',
    description: `50k insert=${metrics.insertMs.toFixed(1)}ms, 40 jumps=${metrics.scrollMs.toFixed(1)}ms`,
  })
  expect(metrics.length).toBe(50_000)
  expect(metrics.insertMs).toBeLessThan(3_000)
  expect(metrics.scrollMs).toBeLessThan(2_000)
})
