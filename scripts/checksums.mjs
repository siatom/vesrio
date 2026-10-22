#!/usr/bin/env node
/**
 * Write reproducible SHA-256 checksums for release artifacts and lockfiles.
 *
 * Usage: node scripts/checksums.mjs [--allow-missing]
 *   --allow-missing  do not fail when build artifacts have not been produced yet
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const allowMissing = process.argv.includes('--allow-missing')

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function findNsisInstaller() {
  const dir = join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => join(dir, name))
}

const targets = [
  join(root, 'src-tauri', 'target', 'release', 'vesrio.exe'),
  ...findNsisInstaller(),
  join(root, 'pnpm-lock.yaml'),
  join(root, 'src-tauri', 'Cargo.lock'),
  join(root, 'package.json'),
  join(root, 'src-tauri', 'tauri.conf.json'),
]

const missing = targets.filter((path) => !existsSync(path) || !statSync(path).isFile())
if (missing.length > 0 && !allowMissing) {
  for (const path of missing) {
    process.stderr.write(`missing release input: ${relative(root, path)}\n`)
  }
  process.exitCode = 1
}

const lines = []
for (const path of targets) {
  if (!existsSync(path) || !statSync(path).isFile()) continue
  const display = relative(root, path).split(sep).join('/')
  lines.push(`${sha256(path)}  ${display}`)
}

const outDir = join(root, 'release')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'SHA256SUMS.txt')
writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8')
process.stdout.write(`wrote ${relative(root, outFile)} (${lines.length} files)\n`)
for (const line of lines) process.stdout.write(`${line}\n`)

if (missing.length > 0) {
  process.stderr.write(
    `note: ${missing.length} optional artifact(s) missing; rerun after \`pnpm tauri build\`\n`,
  )
}
