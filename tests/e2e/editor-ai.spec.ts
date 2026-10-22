import { expect, test } from '@playwright/test'
import { bootApp, editorText, generateSuggestion, SAMPLE, selectSample } from './helpers'

test.describe('offline editor and inline AI review loop', () => {
  test('boots, renders Markdown, and saves without a desktop crash', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await bootApp(page)
    await expect(page.locator('.outline-item').first()).toContainText('欢迎来到文屿')
    await expect(page.locator('.cm-content')).toContainText(SAMPLE)
    await page.keyboard.press('Control+s')
    await expect(page.locator('.save-state')).toContainText('已保存')
    expect(errors).toEqual([])
  })

  test('accepts a suggestion, changes only the target, and undoes in one step', async ({ page }) => {
    await bootApp(page)
    const before = await editorText(page)
    await generateSuggestion(page)

    await expect(page.locator('.suggestion-card .diff-add').first()).toBeVisible()
    await expect(page.locator('.suggestion-card .diff-remove').first()).toBeVisible()

    await page.locator('.suggestion-card').getByRole('button', { name: '接受' }).click()
    await expect(page.locator('.suggestion-card')).toBeHidden()
    const after = await editorText(page)
    expect(after).not.toBe(before)
    expect(after).toContain('构建适配包括编译参数调整')
    // Everything outside the selection is untouched.
    expect(after).toContain('# 欢迎来到文屿')
    expect(after).toContain('## 下一步')
    expect(after).toContain('| 无损保存 | 已实现 |')

    await page.keyboard.press('Control+z')
    expect(await editorText(page)).toBe(before)
  })

  test('rejecting a suggestion leaves the document byte-for-byte unchanged', async ({ page }) => {
    await bootApp(page)
    const before = await editorText(page)
    await generateSuggestion(page)
    await page.locator('.suggestion-card').getByRole('button', { name: '拒绝' }).click()
    await expect(page.locator('.suggestion-card')).toBeHidden()
    expect(await editorText(page)).toBe(before)
  })

  test('editing during review makes the old suggestion stale and blocks apply', async ({ page }) => {
    await bootApp(page)
    await generateSuggestion(page)
    const before = await editorText(page)
    await page.evaluate(() => {
      const editor = (window as unknown as { __vesrioEditor?: { replaceRange: (a: number, b: number, text: string) => void; getText: () => string } })
        .__vesrioEditor
      if (!editor) throw new Error('editor test hook missing')
      editor.replaceRange(0, 0, '插入一行。\n')
    })
    await page.locator('.suggestion-card').getByRole('button', { name: '接受' }).click()
    await expect(page.locator('.suggestion-card')).toContainText('原文在生成期间发生了变化')
    await expect(
      page.getByRole('status').filter({ hasText: '原文已变化' }),
    ).toBeVisible()
    const after = await editorText(page)
    expect(after).toBe(`插入一行。\n${before}`)
  })

  test('cancel during streaming does not modify the document', async ({ page }) => {
    await bootApp(page)
    const before = await editorText(page)
    await selectSample(page)
    await page.locator('.selection-toolbar').getByRole('button', { name: '精简' }).click()
    const dialog = page.getByRole('dialog', { name: '行内 AI' })
    await dialog.getByRole('button', { name: '生成建议' }).click()
    await page.getByRole('button', { name: '发送给模型' }).click()
    await expect(page.locator('.suggestion-card')).toBeVisible()
    await page.locator('.suggestion-card').getByRole('button', { name: '取消' }).click()
    await expect(page.locator('.suggestion-card')).toBeHidden()
    expect(await editorText(page)).toBe(before)
  })

  test('multiple candidates can be switched before accepting', async ({ page }) => {
    await bootApp(page)
    await selectSample(page)
    await page.locator('.selection-toolbar').getByRole('button', { name: '精简' }).click()
    const dialog = page.getByRole('dialog', { name: '行内 AI' })
    await dialog.getByRole('button', { name: '3' }).click()
    await dialog.getByRole('button', { name: '生成建议' }).click()
    await page.getByRole('button', { name: '发送给模型' }).click()
    const card = page.locator('.suggestion-card')
    await expect(card.getByRole('tab', { name: '候选 3' })).toBeVisible()
    await card.getByRole('tab', { name: '候选 2' }).click()
    await expect(card.getByRole('tab', { name: '候选 2' })).toHaveAttribute('aria-selected', 'true')
    await card.getByRole('button', { name: '接受' }).click()
    await expect(card).toBeHidden()
  })
})
