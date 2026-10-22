import { expect, test } from '@playwright/test'
import { bootApp, selectionText } from './helpers'

test.describe('agent conversation', () => {
  test('answers with a resolvable citation and jumps to the source', async ({ page }) => {
    await bootApp(page)
    await page.getByRole('tab', { name: 'Agent' }).click()
    const input = page.locator('.agent-input')
    await expect(input).toBeVisible()
    await input.fill('这段文字的核心主张是什么？')
    await page.getByRole('button', { name: '请求' }).click()

    await expect(page.locator('.agent-preview .outbound')).toBeVisible()
    await expect(page.locator('.agent-preview')).toContainText('mock.local')
    await page.getByRole('button', { name: '发送给模型' }).click()

    const assistant = page.locator('.chat-message--assistant').last()
    await expect(assistant).toContainText('作者始终掌握正文', { timeout: 20_000 })
    const chip = assistant.locator('.citation-chip').first()
    await expect(chip).toBeVisible()
    await chip.click()
    expect(await selectionText(page)).toContain('构建适配需要对原有软件进行一定程度的调整')

    // Agent output must not have touched the document.
    const text = await page.locator('.cm-content').textContent()
    expect(text).toContain('欢迎来到文屿')
  })

  test('agent error path leaves the composer usable', async ({ page }) => {
    await bootApp(page)
    await page.getByRole('tab', { name: 'Agent' }).click()
    await page.locator('.agent-input').fill('只问一个问题')
    await page.getByRole('button', { name: '请求' }).click()
    await expect(page.locator('.agent-preview')).toBeVisible()
    await page.getByRole('button', { name: '返回修改' }).click()
    await expect(page.locator('.agent-input')).toHaveValue('只问一个问题')
  })
})
