#!/usr/bin/env node
// Validates decisions.json, rewrites the icon names in the solution files and
// writes .icon-migration/icon-migration.json for the review page.
//
// Every run rebuilds the touched files from the pristine copies saved on the
// first run (.icon-migration/original), so it is safe to run again after
// changing decisions. --revert puts the pristine copies back.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  WORK_DIR_NAME,
  fail,
  hash,
  isValidTabler,
  loadData,
  readJson,
  solutionDirFromArgs,
  workDir,
  writeJson,
} from './lib.mjs'

const argv = process.argv.slice(2)
const solutionDir = solutionDirFromArgs(argv)
const force = argv.includes('--force')
const dir = workDir(solutionDir)
const originalDir = join(dir, 'original')
const statePath = join(dir, 'state.json')
const data = loadData()

if (!existsSync(join(dir, 'scan.json'))) {
  fail('no .icon-migration/scan.json. Run scan.mjs first.')
}
const scan = readJson(join(dir, 'scan.json'))
const state = existsSync(statePath) ? readJson(statePath) : { written: {} }

function assertUntouched(file) {
  const current = readFileSync(join(solutionDir, file), 'utf8')
  const written = state.written[file]
  if (written && written !== hash(current) && !force) {
    fail(`${file} changed after the last apply. Pass --force to overwrite it from the pristine copy, or --revert first.`)
  }
}

if (argv.includes('--revert')) {
  for (const file of Object.keys(state.written)) {
    assertUntouched(file)
    copyFileSync(join(originalDir, file), join(solutionDir, file))
  }
  rmSync(originalDir, { recursive: true, force: true })
  rmSync(statePath, { force: true })
  console.log(`Restored ${Object.keys(state.written).length} files to their state before the migration.`)
  process.exit(0)
}

const decisions = readJson(join(dir, 'decisions.json'))
const problems = []

function findName(text, name) {
  const match = new RegExp(`(^|[^a-z0-9-])${name.replace(/[-]/g, '\\-')}(?![a-z0-9-])`).exec(text)
  return match ? match.index + match[1].length : -1
}

const items = new Map()
const addItem = (old, item) => items.set(old, { old, uses: 0, where: [], alternatives: [], ...item })

for (const [old, entry] of Object.entries(scan.mapped)) {
  addItem(old, {
    new: entry.new,
    confidence: entry.check ? 'check' : 'high',
    source: 'reference',
    where: [...entry.where],
  })
}
for (const [old, entry] of Object.entries(scan.pending)) {
  addItem(old, { new: null, confidence: 'check', source: 'chosen', where: [...entry.where] })
}

// A position confirmed as an icon. Names that are already valid Tabler icons
// and have no choice stay as they are.
const positions = new Set([...items.values()].flatMap((item) => item.where.map((w) => `${w.file}:${w.line}:${w.col}`)))
function addPosition({ name, file, line, col, context }) {
  if (positions.has(`${file}:${line}:${col}`)) {
    return
  }
  positions.add(`${file}:${line}:${col}`)
  if (!items.has(name)) {
    const mapped = data.mapping[name]
    if (!mapped && !decisions.choices?.[name]?.new && isValidTabler(data, name)) {
      return
    }
    addItem(name, {
      new: mapped ?? null,
      confidence: mapped && !data.check.has(name) ? 'high' : 'check',
      source: mapped ? 'reference' : 'chosen',
    })
  }
  items.get(name).where.push({ file, line, col, context })
}

for (const maybe of scan.maybe) {
  const verdict = decisions.maybe?.[maybe.id]
  if (verdict === 'skip') {
    continue
  }
  if (verdict !== 'icon') {
    problems.push(`maybe ${maybe.id} (${maybe.name}) has no decision; set "icon" or "skip"`)
    continue
  }
  addPosition(maybe)
}

// Positions the scan missed, added by hand: { file, line, name, col? }.
for (const extra of decisions.extra ?? []) {
  const path = join(solutionDir, WORK_DIR_NAME, 'original', extra.file)
  const source = existsSync(path) ? path : join(solutionDir, extra.file)
  if (!extra.file || !extra.line || !extra.name || !existsSync(source)) {
    problems.push(`extra ${JSON.stringify(extra)} needs an existing file, a line and a name`)
    continue
  }
  const text = readFileSync(source, 'utf8').split(/\r?\n/)[extra.line - 1] ?? ''
  const col = extra.col ?? findName(text, extra.name)
  if (col < 0 || text.slice(col, col + extra.name.length) !== extra.name) {
    problems.push(`extra ${extra.file}:${extra.line} does not contain "${extra.name}"${extra.col === undefined ? '' : ` at column ${extra.col}`}`)
    continue
  }
  addPosition({ name: extra.name, file: extra.file, line: extra.line, col, context: text.trim().slice(0, 140) })
}

for (const [old, choice] of Object.entries(decisions.choices ?? {})) {
  const item = items.get(old)
  if (!item) {
    continue
  }
  if (choice.new && choice.new !== item.new) {
    if (item.source === 'reference') {
      item.note = `Changed from the reference pick ${item.new}`
    }
    item.new = choice.new
  }
  item.alternatives = choice.alternatives ?? item.alternatives
  item.confidence = choice.confidence ?? item.confidence
  item.note = choice.note || item.note
  if (choice.oldSvg) {
    item.oldSvg = choice.oldSvg
  }
}

for (const item of items.values()) {
  if (!item.new) {
    problems.push(`${item.old} has no Tabler name; set decisions.choices["${item.old}"].new`)
    continue
  }
  if (!isValidTabler(data, item.new)) {
    problems.push(`${item.old} -> ${item.new}: not a Tabler ${data.tablerVersion} outline icon; choose another`)
  }
  const invalid = item.alternatives.filter((name) => !isValidTabler(data, name))
  if (invalid.length) {
    problems.push(`${item.old}: alternatives ${invalid.join(', ')} are not Tabler outline icons`)
  }
  item.uses = item.where.length
}

if (problems.length) {
  console.error('Fix decisions.json and run apply.mjs again:')
  problems.forEach((problem) => console.error(`  - ${problem}`))
  process.exit(1)
}

const editsByFile = new Map()
for (const item of items.values()) {
  for (const where of item.where) {
    if (!editsByFile.has(where.file)) {
      editsByFile.set(where.file, [])
    }
    editsByFile.get(where.file).push({ ...where, old: item.old, new: item.new })
  }
}
const iconsAsset = existsSync(join(solutionDir, 'assets/icons.jigx')) ? 'assets/icons.jigx' : undefined
if (iconsAsset && !editsByFile.has(iconsAsset)) {
  const pristine = existsSync(join(originalDir, iconsAsset)) ? join(originalDir, iconsAsset) : join(solutionDir, iconsAsset)
  if (state.written[iconsAsset] || dedupeIconsAsset(readFileSync(pristine, 'utf8').split('\n')).removed.length) {
    editsByFile.set(iconsAsset, [])
  }
}

function dedupeIconsAsset(lines) {
  const seen = new Set()
  const removed = []
  const kept = lines.filter((line) => {
    const match = /^\s*-\s+(['"]?)([a-z0-9-]+)\1\s*$/.exec(line)
    if (!match) {
      return true
    }
    if (seen.has(match[2])) {
      removed.push(match[2])
      return false
    }
    seen.add(match[2])
    return true
  })
  return { kept, removed }
}

const newState = { written: {} }
let duplicatesRemoved = []
const filesToRestore = Object.keys(state.written).filter((file) => !editsByFile.has(file))

for (const file of [...editsByFile.keys(), ...filesToRestore]) {
  const target = join(solutionDir, file)
  const original = join(originalDir, file)
  assertUntouched(file)
  if (!existsSync(original)) {
    mkdirSync(dirname(original), { recursive: true })
    copyFileSync(target, original)
  }

  const source = readFileSync(original, 'utf8')
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  let lines = source.split(eol)
  const edits = (editsByFile.get(file) ?? []).sort((a, b) => a.line - b.line || b.col - a.col)
  for (const edit of edits) {
    const line = lines[edit.line - 1]
    if (line?.slice(edit.col, edit.col + edit.old.length) !== edit.old) {
      fail(`${file}:${edit.line} no longer holds "${edit.old}" at column ${edit.col}. Run scan.mjs again.`)
    }
    lines[edit.line - 1] = line.slice(0, edit.col) + edit.new + line.slice(edit.col + edit.old.length)
  }
  if (file === iconsAsset) {
    const { kept, removed } = dedupeIconsAsset(lines)
    lines = kept
    duplicatesRemoved = removed
  }

  const output = lines.join(eol)
  writeFileSync(target, output)
  if (filesToRestore.includes(file)) {
    continue
  }
  newState.written[file] = hash(output)
}
writeJson(statePath, newState)

const output = {
  solution: scan.solution,
  tablerVersion: scan.tablerVersion,
  icons: [...items.values()].map((item) => ({
    ...item,
    where: item.where.map(({ col: _col, ...where }) => where),
  })),
  notMigrated: decisions.notMigrated ?? [],
  fromData: decisions.fromData ?? [],
  duplicatesRemoved,
}
writeJson(join(dir, 'icon-migration.json'), output)

const changedUses = output.icons.reduce((sum, item) => sum + item.uses, 0)
console.log(`Applied: ${Object.keys(newState.written).length} files, ${changedUses} icon uses, ${output.icons.length} old names.`)
const checks = output.icons.filter((item) => item.confidence === 'check')
if (checks.length) {
  console.log('To check:')
  checks.forEach((item) => {
    const reason = item.note || (item.source === 'reference' ? 'approximate reference pick' : 'no reason given')
    const alternatives = item.alternatives.length ? `; alternatives: ${item.alternatives.join(', ')}` : ''
    console.log(`  ${item.old} -> ${item.new} (${reason}${alternatives})`)
  })
}
if (duplicatesRemoved.length) {
  console.log(`Removed duplicates from ${iconsAsset}: ${duplicatesRemoved.join(', ')}`)
}
console.log(`Wrote ${join(dir, 'icon-migration.json')}`)
