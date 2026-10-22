import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtureDir = join(root, 'tests', 'fixtures', 'markdown')

const manifest = JSON.parse(await readFile(join(fixtureDir, 'FINGERPRINTS.json'), 'utf8'))
const files = (await readdir(fixtureDir)).filter((name) => name.endsWith('.md')).sort()

let failures = 0
for (const name of files) {
  const bytes = await readFile(join(fixtureDir, name))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const expected = manifest.samples[name]
  if (!expected) {
    console.error(`✗ ${name}: not present in FINGERPRINTS.json`)
    failures += 1
    continue
  }
  if (expected.sha256 !== sha256) {
    console.error(`✗ ${name}: sha256 mismatch`)
    console.error(`  expected ${expected.sha256}`)
    console.error(`  actual   ${sha256}`)
    failures += 1
  } else if (expected.bytes !== bytes.length) {
    console.error(`✗ ${name}: size mismatch (${expected.bytes} vs ${bytes.length})`)
    failures += 1
  }
}

for (const name of Object.keys(manifest.samples)) {
  if (!files.includes(name)) {
    console.error(`✗ ${name}: missing from fixture directory`)
    failures += 1
  }
}

if (failures > 0) {
  console.error(`\nGolden fingerprint check failed with ${failures} problem(s).`)
  process.exit(1)
}
console.log(`✓ ${files.length} golden samples match their fingerprints.`)
