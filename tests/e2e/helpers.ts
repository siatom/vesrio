import { expect, type Page } from '@playwright/test'

export const SAMPLE = '构建适配需要对原有软件进行一定程度的调整'

export async function bootApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('.editor-host .cm-content')).toBeVisible()
  await expect(page.locator('.titlebar')).toContainText('欢迎')
}

export async function selectSample(page: Page): Promise<void> {
  await page.evaluate((needle) => {
    const editor = (window as unknown as {
      __vesrioEditor?: { getText: () => string; selectRange: (from: number, to: number) => void }
    }).__vesrioEditor
    if (!editor) throw new Error('editor test hook missing')
    const text = editor.getText()
    const from = text.indexOf(needle)
    if (from < 0) throw new Error(`sample not found: ${needle}`)
    editor.selectRange(from, from + needle.length)
  }, SAMPLE)
  await expect(page.locator('.selection-toolbar')).toBeVisible()
}

export async function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window as unknown as { __vesrioEditor?: { getText: () => string } })
      .__vesrioEditor
    if (!editor) throw new Error('editor test hook missing')
    return editor.getText()
  })
}

export async function selectionText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window as unknown as {
      __vesrioEditor?: { getSelection: () => { text: string } }
    }).__vesrioEditor
    if (!editor) throw new Error('editor test hook missing')
    return editor.getSelection().text
  })
}

export async function generateSuggestion(page: Page): Promise<void> {
  await selectSample(page)
  await page.locator('.selection-toolbar').getByRole('button', { name: '精简' }).click()
  const dialog = page.getByRole('dialog', { name: '行内 AI' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '生成建议' }).click()
  await expect(page.locator('.outbound')).toBeVisible()
  await page.getByRole('button', { name: '发送给模型' }).click()
  await expect(page.locator('.suggestion-card')).toBeVisible()
  // Wait for the stream to finish; the card is visible while it streams.
  await expect(page.locator('.suggestion-card .suggestion-streaming')).toBeHidden({
    timeout: 15_000,
  })
  await expect(page.locator('.suggestion-card').getByRole('button', { name: '接受' })).toBeEnabled()
}
