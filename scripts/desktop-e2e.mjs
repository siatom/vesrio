#!/usr/bin/env node
/* global document, window, HTMLImageElement */
/**
 * Desktop E2E smoke test against the real Tauri/WebView2 application.
 *
 * It builds nothing: run the following first (or use `pnpm test:desktop`,
 * which does both):
 *
 *   pnpm exec tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json
 *   node scripts/desktop-e2e.mjs
 *
 * The test uses an isolated identifier (`com.vesrio.app.e2e`) and a throwaway
 * WebView2 profile, seeds a CRLF golden document, drives the real editor via
 * WebView2 CDP, saves through Rust, and verifies the exact bytes on disk.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = join(root, 'src-tauri', 'target', 'debug', 'vesrio.exe')
const appData = join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? root, 'AppData', 'Roaming'), 'com.vesrio.app.e2e')
const workRoot = join(tmpdir(), 'vesrio-desktop-e2e')
const docsDir = join(workRoot, 'docs')
const samplePath = join(docsDir, 'crlf-sample.md')
const webviewDir = join(workRoot, 'webview')
const screenshotPath = join(root, 'test-results', 'desktop-e2e.png')
const port = 9223
const marker = '桌面端 E2E 追加 2026'

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function waitForCdp() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        if (targets.some((target) => target.type === 'page')) return targets
      }
    } catch {
      // WebView2 is still starting.
    }
    await sleep(300)
  }
  throw new Error(`WebView2 CDP endpoint did not become ready on port ${port}`)
}

function prepareDatabase() {
  mkdirSync(appData, { recursive: true })
  mkdirSync(docsDir, { recursive: true })
  rmSync(webviewDir, { recursive: true, force: true })
  const fixture = readFileSync(join(root, 'tests', 'fixtures', 'markdown', '03-crlf.md'))
  writeFileSync(samplePath, fixture)

  const dbPath = join(appData, 'vesrio.db')
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  rmSync(`${dbPath}-wal`, { force: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(readFileSync(join(root, 'src-tauri', 'migrations', '0001_init.sql'), 'utf8'))
    db.exec('PRAGMA user_version = 1')
    const now = new Date().toISOString()
    const setting = db.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    )
    setting.run('lastFolder', JSON.stringify(docsDir), now)
    setting.run('lastDocument', JSON.stringify(samplePath), now)
    db.prepare(
      `INSERT INTO documents (id, canonical_path, title, project_id, last_opened_at, created_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run('e2e-doc-1', samplePath, 'crlf-sample', now, now)
  } finally {
    db.close()
  }
  return fixture
}

function killTree(pid) {
  return new Promise((resolvePromise) => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    killer.on('exit', () => resolvePromise())
    killer.on('error', () => resolvePromise())
  })
}

async function main() {
  assert.ok(
    existsSync(exe),
    `missing ${exe}; build it with: pnpm exec tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json`,
  )
  rmSync(appData, { recursive: true, force: true })
  rmSync(workRoot, { recursive: true, force: true })
  const original = prepareDatabase()
  mkdirSync(dirname(screenshotPath), { recursive: true })

  const logPath = join(workRoot, 'app.log')
  const log = spawn('powershell', ['-NoProfile', '-Command', `& '${exe}' *> '${logPath}'`], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: webviewDir,
      VESRIO_SECRET_SERVICE: 'com.vesrio.app.e2e',
    },
    stdio: 'ignore',
  })
  let browser
  let checks = 0
  try {
    await waitForCdp()
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    assert.ok(context, 'CDP exposed no browser context')
    const page = context.pages()[0]
    assert.ok(page, 'CDP exposed no page')
    page.setDefaultTimeout(20_000)

    await page.locator('.editor-host .cm-content').waitFor({ state: 'visible' })
    checks += 1
    await page.waitForFunction(
      () => document.querySelector('.titlebar')?.textContent?.includes('crlf-sample') ?? false,
    )
    checks += 1

    // The app owns the title bar: the native frame is off and all three
    // caption buttons are rendered by the webview.
    assert.equal(
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_decorated')),
      false,
    )
    assert.deepEqual(
      await page
        .locator('.window-controls .window-control')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
      ['最小化', '最大化', '关闭窗口'],
    )
    checks += 1

    const info = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_app_info'))
    assert.equal(info.platform, 'windows-x86_64')
    checks += 1

    const visibleText = await page.locator('.cm-content').innerText()
    assert.match(visibleText, /CRLF 文档/)
    assert.match(visibleText, /保存时不应把 CRLF 改成 LF/)
    checks += 1

    // Opening must not touch the file.
    assert.deepEqual(readFileSync(samplePath), original)
    checks += 1

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText(marker)
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('未保存') ?? false,
    )
    checks += 1

    // Undo/redo uses the real CodeMirror history. Windows redo is Ctrl+Y.
    await page.keyboard.press('Control+z')
    await page.waitForFunction(
      (text) => !(document.querySelector('.cm-content')?.textContent ?? '').includes(text),
      marker,
    )
    await page.keyboard.press('Control+y')
    await page.waitForFunction(
      (text) => (document.querySelector('.cm-content')?.textContent ?? '').includes(text),
      marker,
    )
    checks += 1

    await page.keyboard.press('Control+s')
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('已保存') ?? false,
    )
    checks += 1

    const expected = Buffer.concat([original, Buffer.from(`\r\n${marker}`, 'utf8')])
    assert.deepEqual(readFileSync(samplePath), expected)
    checks += 1

    // External modification must never be overwritten silently.
    writeFileSync(samplePath, Buffer.concat([expected, Buffer.from('外部修改\r\n', 'utf8')]))
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('本地追加')
    await page.keyboard.press('Control+s')
    const conflict = page.getByRole('alertdialog', { name: '外部冲突' })
    await conflict.waitFor()
    assert.deepEqual(
      readFileSync(samplePath),
      Buffer.concat([expected, Buffer.from('外部修改\r\n', 'utf8')]),
    )
    checks += 1

    await conflict.getByRole('button', { name: '保留当前内容并覆盖' }).click()
    await conflict.waitFor({ state: 'hidden' })
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('已保存') ?? false,
    )
    const expectedLocal = Buffer.concat([expected, Buffer.from('\r\n本地追加', 'utf8')])
    assert.deepEqual(readFileSync(samplePath), expectedLocal)
    checks += 1

    // Manual snapshot, edit, restore, and save must return the snapshot bytes.
    await page.locator('.titlebar').getByRole('button', { name: '创建快照' }).click()
    await page.getByRole('status').filter({ hasText: '已创建快照' }).waitFor()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('临时内容')
    await page.keyboard.press('Control+s')
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('已保存') ?? false,
    )
    assert.deepEqual(
      readFileSync(samplePath),
      Buffer.concat([expectedLocal, Buffer.from('\r\n临时内容', 'utf8')]),
    )
    checks += 1

    await page.getByRole('tab', { name: '修订' }).click()
    await page.locator('.snapshot-item').first().waitFor()
    checks += 1

    await page.locator('.snapshot-item').first().getByRole('button', { name: '恢复' }).click()
    await page.getByRole('button', { name: '恢复', exact: true }).last().click()
    await page.getByRole('status').filter({ hasText: '已恢复到快照' }).waitFor()
    await page.keyboard.press('Control+s')
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('已保存') ?? false,
    )
    assert.deepEqual(readFileSync(samplePath), expectedLocal)
    checks += 1

    // Project style is persisted in real SQLite and survives reopening.
    await page.locator('.sidebar').getByRole('button', { name: /项目风格卡/ }).click()
    const styleDialog = page.getByRole('dialog', { name: '项目风格卡' })
    await styleDialog.waitFor()
    await styleDialog.getByPlaceholder('例如：平实、克制、适量举例').fill('克制、技术准确')
    await styleDialog.getByRole('button', { name: '保存风格卡' }).click()
    await page.getByRole('status').filter({ hasText: '风格卡已保存' }).waitFor()
    await page.keyboard.press('Escape')
    await styleDialog.waitFor({ state: 'hidden' })
    await page.locator('.sidebar').getByRole('button', { name: /项目风格卡/ }).click()
    await page
      .getByRole('dialog', { name: '项目风格卡' })
      .getByPlaceholder('例如：平实、克制、适量举例')
      .waitFor()
    assert.equal(
      await page
        .getByRole('dialog', { name: '项目风格卡' })
        .getByPlaceholder('例如：平实、克制、适量举例')
        .inputValue(),
      '克制、技术准确',
    )
    await page.keyboard.press('Escape')
    checks += 1

    // With no API key, the real backend must fail safely without touching text.
    const beforeAgent = readFileSync(samplePath)
    await page.getByRole('tab', { name: 'Agent' }).click()
    await page.getByLabel('向 Agent 提问').fill('请总结这段文字，并指出缺失的证据。')
    await page.getByRole('button', { name: '请求' }).click()
    await page.getByRole('button', { name: '发送给模型' }).waitFor()
    await page.getByRole('button', { name: '发送给模型' }).click()
    await page.locator('.agent-error').filter({ hasText: '尚未配置模型服务' }).waitFor()
    assert.deepEqual(readFileSync(samplePath), beforeAgent)
    checks += 1

    const beforeTheme = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: '切换主题' }).click()
    await page.waitForFunction(
      (previous) => document.documentElement.dataset.theme !== previous,
      beforeTheme,
    )
    checks += 1

    await page.keyboard.press('Control+Shift+f')
    await page.locator('.sidebar').waitFor({ state: 'hidden' })
    await page.keyboard.press('Escape')
    await page.locator('.sidebar').waitFor({ state: 'visible' })
    checks += 1

    await page.keyboard.press('Control+,')
    const settingsDialog = page.getByRole('dialog', { name: '设置' })
    await settingsDialog.waitFor()
    await settingsDialog.getByRole('button', { name: '模型服务' }).click()
    assert.equal(
      await settingsDialog.getByLabel('Base URL').inputValue(),
      'https://api.deepseek.com',
    )
    assert.equal(await settingsDialog.getByLabel('模型名称').inputValue(), 'deepseek-flash')
    checks += 1
    await page.keyboard.press('Escape')
    await settingsDialog.waitFor({ state: 'hidden' })
    checks += 1

    // Live preview images and math must work in the real WebView. The image is
    // loaded through the Tauri asset protocol, not a browser blob/object URL.
    writeFileSync(
      join(docsDir, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1ZkAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('![pixel](pixel.png)')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('$$ E=mc^2 $$')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('末尾')
    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(() => {
      const image = document.querySelector('.cm-md-image__img')
      const math = document.querySelector('.cm-md-math--block')
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0 &&
        math !== null
      )
    })
    checks += 1

    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('```mermaid\ngraph TD\n  A[Start] --> B[End]\n```')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.insertText('末尾 2')
    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(() => document.querySelector('.cm-md-mermaid svg') !== null)
    checks += 1

    await page.screenshot({ path: screenshotPath, fullPage: false })
    console.log(`desktop e2e: PASS (${checks} checks)`)
    console.log(`- app data: ${appData}`)
    console.log(`- first save bytes: ${expected.length} (CRLF preserved)`)
    console.log(`- screenshot: ${screenshotPath}`)
  } catch (error) {
    console.error(`desktop e2e: FAIL`)
    if (existsSync(logPath)) {
      console.error('--- app log tail ---')
      console.error(readFileSync(logPath, 'utf8').split('\n').slice(-40).join('\n'))
    }
    throw error
  } finally {
    await browser?.close().catch(() => {})
    await killTree(log.pid)
    await sleep(1000)
    rmSync(appData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
    rmSync(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
