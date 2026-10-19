#!/usr/bin/env node
// Scans a Jigx solution and writes .icon-migration/scan.json plus a
// decisions.json skeleton for the agent.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WORK_DIR_NAME, fail, loadData, readJson, solutionDirFromArgs, workDir, writeJson } from './lib.mjs'
import { scanSolution } from './scanner.mjs'

const argv = process.argv.slice(2)
const solutionDir = solutionDirFromArgs(argv)
const force = argv.includes('--force')
const dir = workDir(solutionDir)

if (existsSync(join(dir, 'original')) && !force) {
  fail('this solution was already migrated (.icon-migration/original exists). Run apply.mjs --revert first, or pass --force to scan the current files.')
}

// .icon-migration holds full copies of the original files; keep it out of git
// without touching the repo's own .gitignore.
function excludeFromGit() {
  try {
    const excludePath = resolve(
      solutionDir,
      execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: solutionDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    )
    const pattern = `${WORK_DIR_NAME}/`
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    if (!current.split('\n').includes(pattern)) {
      appendFileSync(excludePath, `${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`)
      console.log(`Added ${pattern} to ${excludePath}`)
    }
  } catch {
    // Not a git repo, or git is missing: nothing to exclude from.
  }
}

const result = scanSolution(solutionDir, loadData())
excludeFromGit()
writeJson(join(dir, 'scan.json'), result)

const decisionsPath = join(dir, 'decisions.json')
const decisions = existsSync(decisionsPath)
  ? readJson(decisionsPath)
  : { choices: {}, maybe: {}, extra: [], notMigrated: [], fromData: [] }
decisions.extra ??= []
for (const name of Object.keys(result.pending)) {
  decisions.choices[name] ??= { new: null, alternatives: [], confidence: 'high', note: '' }
}
for (const item of result.maybe) {
  decisions.maybe[item.id] ??= null
}
if (!decisions.fromData.length) {
  decisions.fromData = result.fromData
}
writeJson(decisionsPath, decisions)

const uses = (bucket) => Object.values(bucket).reduce((sum, item) => sum + item.where.length, 0)
console.log(`Scanned ${result.solution}`)
console.log(`  mapped:    ${Object.keys(result.mapped).length} names, ${uses(result.mapped)} uses (from the reference mapping)`)
console.log(`  pending:   ${Object.keys(result.pending).length} names, ${uses(result.pending)} uses (choose a Tabler name)`)
console.log(`  maybe:     ${result.maybe.length} places (decide "icon" or "skip")`)
console.log(`  dynamic:   ${result.dynamic.length} icon expressions without literal names (check for fromData)`)
console.log(`  fromData:  ${result.fromData.length} icon columns read from tables (pre-filled in decisions.json)`)
console.log(`  unchanged: ${Object.keys(result.unchanged).length} names already valid in Tabler`)
for (const [name, item] of Object.entries(result.pending)) {
  const first = item.where[0]
  console.log(`  pending ${name} (${item.where.length}x) ${first.file}:${first.line}${first.label ? ` · ${first.label}` : ''}`)
}
console.log(`Wrote ${join(dir, 'scan.json')} and ${decisionsPath}`)
