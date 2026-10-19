#!/usr/bin/env node
// End-to-end test: scan → decisions → apply → compare with tests/expected-solution →
// revert → compare with the fixture. Pass --update to rewrite the expected files.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const scripts = join(root, '..', 'skills', 'icon-migration', 'scripts')
const fixture = join(root, 'fixture-solution')
const expected = join(root, 'expected-solution')
const work = join(mkdtempSync(join(tmpdir(), 'icon-migration-')), 'fixture-solution')
cpSync(fixture, work, { recursive: true })

const run = (script, ...args) => execFileSync('node', [join(scripts, script), work, ...args], { encoding: 'utf8' })

const listFiles = (dir) => {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.icon-migration') {
        continue
      }
      const path = join(current, entry.name)
      entry.isDirectory() ? visit(path) : files.push(relative(dir, path))
    }
  }
  visit(dir)
  return files.sort()
}

const compare = (actualDir, expectedDir, label) => {
  const failures = []
  const actualFiles = listFiles(actualDir)
  const expectedFiles = listFiles(expectedDir)
  if (actualFiles.join() !== expectedFiles.join()) {
    failures.push(`${label}: file lists differ`)
  }
  for (const file of expectedFiles) {
    const actual = existsSync(join(actualDir, file)) ? readFileSync(join(actualDir, file), 'utf8') : null
    if (actual !== readFileSync(join(expectedDir, file), 'utf8')) {
      failures.push(`${label}: ${file} differs`)
    }
  }
  return failures
}

run('scan.mjs')
const scan = JSON.parse(readFileSync(join(work, '.icon-migration', 'scan.json'), 'utf8'))
const decisions = JSON.parse(readFileSync(join(work, '.icon-migration', 'decisions.json'), 'utf8'))
const expectedMaybe = {
  'components/button.jigx:7:30': 'skip',
  'databases/default.jigx:4:47': 'icon',
  'databases/default.jigx:4:71': 'icon',
  'scripts/cards.js:3:25': 'icon',
}
const failures = []
if (Object.keys(decisions.maybe).sort().join() !== Object.keys(expectedMaybe).sort().join()) {
  failures.push(`maybe ids: ${Object.keys(decisions.maybe).join(', ')}`)
}
if (Object.keys(scan.pending).join() !== 'unknown-thing') {
  failures.push(`pending: ${Object.keys(scan.pending).join(', ')}`)
}
if (scan.dynamic.length !== 1) {
  failures.push(`dynamic: ${scan.dynamic.length}`)
}

decisions.maybe = expectedMaybe
decisions.choices = {
  'unknown-thing': { new: 'help-circle', alternatives: ['question-mark'], confidence: 'check', note: 'No picture' },
  'credit-card-visa': { new: 'credit-card', alternatives: ['brand-visa'], confidence: 'check' },
  'time-clock-circle': { new: 'clock-hour-4' },
}
decisions.fromData = [{ source: 'item.icon from appointments datasource', file: 'jigs/list.jigx', line: 35 }]
writeFileSync(join(work, '.icon-migration', 'decisions.json'), JSON.stringify(decisions, null, 2))

run('apply.mjs')
run('apply.mjs')

if (process.argv.includes('--update')) {
  rmSync(expected, { recursive: true, force: true })
  cpSync(work, expected, { recursive: true, filter: (path) => !path.includes('.icon-migration') })
  console.log(`Updated ${expected}`)
  process.exit(0)
}

failures.push(...compare(work, expected, 'after apply'))
run('review.mjs', '--no-open')
if (!readFileSync(join(work, '.icon-migration', 'review.html'), 'utf8').includes('"unknown-thing"')) {
  failures.push('review.html does not embed the result')
}
run('apply.mjs', '--revert')
failures.push(...compare(work, fixture, 'after revert'))

if (failures.length) {
  console.error('FAIL')
  failures.forEach((failure) => console.error(`  ${failure}`))
  process.exit(1)
}
console.log('PASS')
