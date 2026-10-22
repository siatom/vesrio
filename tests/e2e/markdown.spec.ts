import { expect, test } from '@playwright/test'
import { bootApp } from './helpers'

test.describe('Markdown live preview enhancements', () => {
  test('renders math, images, links, and wraps long prose', async ({ page }) => {
    await bootApp(page)
    await page.evaluate(() => {
      const editor = (
        window as unknown as {
          __vesrioEditor?: {
            replaceRange: (from: number, to: number, text: string) => void
            selectRange: (from: number, to: number) => void
          }
        }
      ).__vesrioEditor
      if (!editor) throw new Error('editor test hook missing')
      editor.replaceRange(
        0,
        0,
        [
          '# 预览增强',
          '',
          '行内公式 $E=mc^2$ 与链接 [示例](https://example.com)。',
          '',
          '$$',
          'a^2 + b^2 = c^2',
          '$$',
          '',
          '![封面](../assets/cover.png)',
          '',
          '```mermaid',
          'graph TD',
          '  A[开始] --> B[结束]',
          '```',
          '',
          `${'长行内容 '.repeat(300)}`,
          '',
        ].join('\n'),
      )
      editor.selectRange(0, 0)
    })

    await expect(page.locator('.cm-md-math--inline')).toHaveCount(1)
    await expect(page.locator('.cm-md-math--block')).toHaveCount(1)
    await expect(page.locator('.cm-md-image')).toHaveCount(1)
    await expect(page.locator('.cm-md-link')).toContainText('示例')
    await expect(page.locator('.cm-md-mermaid svg')).toBeVisible({ timeout: 20_000 })

    const overflow = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      if (!(scroller instanceof HTMLElement)) throw new Error('scroller missing')
      return scroller.scrollWidth - scroller.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(2)

    const popupPromise = page.waitForEvent('popup')
    await page.locator('.cm-md-link').first().click()
    const popup = await popupPromise
    expect(popup).toBeTruthy()
    await popup.close()

    await page.locator('.cm-md-math--block').click()
    await expect(page.locator('.cm-md-math--block')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('a^2 + b^2 = c^2')

    await page.locator('.cm-md-image').click()
    await expect(page.locator('.cm-md-image')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('../assets/cover.png')

    await page.locator('.cm-md-mermaid').click()
    await expect(page.locator('.cm-md-mermaid')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('graph TD')
  })
})
