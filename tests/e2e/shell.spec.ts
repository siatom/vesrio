import { expect, test } from '@playwright/test'
import { bootApp, editorText } from './helpers'

test.describe('desktop shell', () => {
  test('switches theme, toggles focus mode, and restores panels with the keyboard', async ({ page }) => {
    await bootApp(page)
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.getByRole('button', { name: '切换主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.keyboard.press('Control+Shift+f')
    await expect(page.locator('.sidebar')).toBeHidden()
    await expect(page.locator('.inspector')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar')).toBeVisible()
  })

  test('restores collapsed panels even when no document is open', async ({ page }) => {
    await bootApp(page)
    await page.keyboard.press('Control+w')
    await expect(page.locator('.empty-state')).toBeVisible()

    await page.getByRole('button', { name: '收起侧栏' }).click()
    await expect(page.locator('.sidebar')).toBeHidden()
    await page.getByRole('button', { name: '收起右侧面板' }).click()
    await expect(page.locator('.inspector')).toBeHidden()

    await page.getByRole('button', { name: '展开左侧栏' }).click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.getByRole('button', { name: '展开右侧栏' }).click()
    await expect(page.locator('.inspector')).toBeVisible()
  })

  test('resizes both sidebars by dragging and with the keyboard', async ({ page }) => {
    await bootApp(page)
    const sidebar = page.locator('.sidebar')
    const inspector = page.locator('.inspector')
    const sidebarBefore = (await sidebar.boundingBox())!.width
    const inspectorBefore = (await inspector.boundingBox())!.width

    const leftHandle = page.getByRole('separator', { name: '调整左侧栏宽度' })
    const leftBox = (await leftHandle.boundingBox())!
    await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(leftBox.x + leftBox.width / 2 + 60, leftBox.y + leftBox.height / 2, {
      steps: 4,
    })
    await page.mouse.up()
    expect((await sidebar.boundingBox())!.width).toBeGreaterThan(sidebarBefore + 40)

    const rightHandle = page.getByRole('separator', { name: '调整右侧栏宽度' })
    await rightHandle.focus()
    await page.keyboard.press('ArrowLeft')
    expect((await inspector.boundingBox())!.width).toBeGreaterThan(inspectorBefore)
  })

  test('command palette finds and runs a command', async ({ page }) => {
    await bootApp(page)
    await page.keyboard.press('Control+k')
    const palette = page.locator('.palette')
    await expect(palette).toBeVisible()
    await palette.locator('.palette__input').fill('设置')
    await expect(palette.locator('.palette__item').first()).toContainText('打开设置')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '设置' })).toBeHidden()
  })

  test('settings show saved key state and never print the key', async ({ page }) => {
    await bootApp(page)
    await page.getByRole('button', { name: '设置' }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '模型服务' }).click()
    await expect(dialog).toContainText('已安全保存')
    await expect(dialog.locator('input[type="password"]')).toHaveValue('')
    await expect(dialog).toContainText('API Key 只保存在系统凭据库')
    await dialog.getByRole('button', { name: 'DeepSeek' }).click()
    await expect(dialog.getByLabel('Base URL')).toHaveValue('https://api.deepseek.com')
    await expect(dialog.getByLabel('模型名称')).toHaveValue('deepseek-flash')
  })

  test('style card saves and reloads project rules', async ({ page }) => {
    await bootApp(page)
    await page.locator('.sidebar').getByRole('button', { name: /项目风格卡/ }).click()
    const dialog = page.getByRole('dialog', { name: '项目风格卡' })
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('例如：平实、克制、适量举例').fill('克制、技术准确')
    await dialog.getByRole('button', { name: '保存风格卡' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: '风格卡已保存' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    await page.locator('.sidebar').getByRole('button', { name: /项目风格卡/ }).click()
    await expect(
      page.getByRole('dialog', { name: '项目风格卡' }).getByPlaceholder('例如：平实、克制、适量举例'),
    ).toHaveValue('克制、技术准确')
  })

  test('shortcuts dialog is reachable from the keyboard', async ({ page }) => {
    await bootApp(page)
    await page.keyboard.press('Control+/')
    await expect(page.getByRole('dialog', { name: '快捷键' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '快捷键' })).toBeHidden()
  })

  test('creates and restores a manual snapshot from the revisions panel', async ({ page }) => {
    await bootApp(page)
    const before = await editorText(page)
    await page.getByRole('tab', { name: '修订' }).click()
    await page.getByRole('button', { name: '创建快照' }).last().click()
    await expect(page.locator('.snapshot-item')).toHaveCount(1)
    await page.locator('.snapshot-item').getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '恢复', exact: true }).last().click()
    await expect(
      page.getByRole('status').filter({ hasText: '已恢复到快照' }),
    ).toBeVisible()
    expect(await editorText(page)).toBe(before)
  })

  test('source mode reveals Markdown markers', async ({ page }) => {
    await bootApp(page)
    // Live preview hides markers on quiet lines; the caret's own line stays raw.
    await page.evaluate(() => {
      const editor = (window as unknown as {
        __vesrioEditor?: {
          getText: () => string
          selectRange: (from: number, to: number) => void
        }
      }).__vesrioEditor
      if (!editor) throw new Error('editor test hook missing')
      const offset = editor.getText().indexOf('文屿是一个')
      editor.selectRange(offset, offset)
    })
    await expect(page.locator('.cm-content')).not.toContainText('# 欢迎来到文屿')
    await page.getByRole('button', { name: '源码' }).click()
    await expect(page.locator('.cm-content')).toContainText('# 欢迎来到文屿')
  })
})
