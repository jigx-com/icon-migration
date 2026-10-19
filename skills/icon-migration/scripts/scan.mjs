#!/usr/bin/env node
// Finds every icon name in a Jigx solution and sorts it into mapped, pending
// (needs a choice), maybe (needs a yes/no) and unchanged. Writes
// .icon-migration/scan.json and a decisions.json skeleton for the agent.
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  NAME_RE,
  fail,
  isValidTabler,
  listSolutionFiles,
  loadData,
  readJson,
  solutionDirFromArgs,
  workDir,
  writeJson,
} from './lib.mjs'

const SETTING_KEY_RE =
  /(color|size|position|type|shape|weight|style|variant|opacity|align|placement|visible|background)$/i
const ICON_CHILD_KEYS = new Set(['left', 'right', 'name', 'icon', 'default', 'start', 'end', 'value', 'leading', 'trailing', 'center'])
const LABEL_KEYS = new Set(['title', 'label', 'text', 'subtitle', 'header'])
const KEY_LINE_RE = /^(\s*)((?:-\s+)*)(["']?)([A-Za-z0-9_$.@-]+)\3\s*:(?:\s+(.*)|\s*)$/
const LIST_ITEM_RE = /^(\s*)-\s+(.*)$/
const BLOCK_SCALAR_RE = /^[|>][-+0-9]*\s*(#.*)?$/
const QUOTED_RE = /(['"`])([a-z0-9]+(?:-[a-z0-9]+)*)\1/g
const COMPARED_BEFORE_RE = /(=|<|>|\bin\s*\[[^\]]*)$/
const COMPARED_AFTER_RE = /^(=(?!>)|!=|<|>)/
const JSON_ICON_RE = /"([A-Za-z]*[iI]con[A-Za-z]*)"\s*:\s*"([^"]*)"/

const argv = process.argv.slice(2)
const solutionDir = solutionDirFromArgs(argv)
const force = argv.includes('--force')
const data = loadData()
const knownOld = new Set([...Object.keys(data.mapping), ...Object.keys(data.streamline)])

if (existsSync(join(workDir(solutionDir), 'original')) && !force) {
  fail('this solution was already migrated (.icon-migration/original exists). Run apply.mjs --revert first, or pass --force to scan the current files.')
}

const result = {
  solution: basename(solutionDir),
  tablerVersion: data.tablerVersion,
  mapped: {},
  pending: {},
  unchanged: {},
  maybe: [],
  dynamic: [],
}
const recorded = new Set()

const isIconKey = (key) => /icon/i.test(key) && !SETTING_KEY_RE.test(key)
const indentOf = (line) => line.length - line.trimStart().length
const cleanContext = (line) => line.trim().slice(0, 140)

function addWhere(bucket, name, where) {
  bucket[name] ??= { where: [] }
  bucket[name].where.push(where)
}

function record({ name, file, lineIndex, col, line, kind, label }) {
  const id = `${file}:${lineIndex + 1}:${col}`
  if (recorded.has(id) || data.keep.has(name)) {
    return
  }
  recorded.add(id)

  const where = { file, line: lineIndex + 1, col, context: cleanContext(line) }
  if (label) {
    where.label = label
  }

  if (data.mapping[name]) {
    addWhere(result.mapped, name, where)
    result.mapped[name].new = data.mapping[name]
    result.mapped[name].check = data.check.has(name)
    return
  }
  if (isValidTabler(data, name)) {
    result.unchanged[name] = (result.unchanged[name] ?? 0) + 1
    return
  }
  if (kind === 'literal' || knownOld.has(name)) {
    addWhere(result.pending, name, where)
    return
  }
  result.maybe.push({ id, name, ...where, reason: 'Unknown string in an icon expression' })
}

function expressionLiterals(line, from) {
  const found = []
  for (const match of line.matchAll(QUOTED_RE)) {
    if (match.index < from) {
      continue
    }
    const before = line.slice(0, match.index).trimEnd()
    const after = line.slice(match.index + match[0].length).trimStart()
    if (COMPARED_BEFORE_RE.test(before) || COMPARED_AFTER_RE.test(after)) {
      continue
    }
    found.push({ name: match[2], col: match.index + 1 })
  }
  return found
}

function findLabel(lines, lineIndex, indent) {
  for (const step of [-1, 1]) {
    for (let k = lineIndex + step; k >= 0 && k < lines.length && Math.abs(k - lineIndex) <= 25; k += step) {
      const match = KEY_LINE_RE.exec(lines[k])
      if (!match) {
        continue
      }
      const keyIndent = match[1].length + match[2].length
      if (keyIndent < indent) {
        break
      }
      const value = (match[5] ?? '').trim()
      if (keyIndent === indent && LABEL_KEYS.has(match[4]) && value && !BLOCK_SCALAR_RE.test(value)) {
        return value.replace(/^(['"])(.*)\1$/, '$2').slice(0, 80)
      }
    }
  }
  return undefined
}

function elementIconNameLines(lines) {
  const found = new Set()
  lines.forEach((line, index) => {
    const match = KEY_LINE_RE.exec(line)
    if (!match || match[4] !== 'element' || (match[5] ?? '').trim() !== 'icon') {
      return
    }
    const indent = match[1].length + match[2].length
    for (const step of match[2] ? [1] : [-1, 1]) {
      for (let k = index + step; k >= 0 && k < lines.length; k += step) {
        const sibling = KEY_LINE_RE.exec(lines[k])
        if (!sibling) {
          continue
        }
        const siblingIndent = sibling[1].length + sibling[2].length
        if (siblingIndent < indent) {
          break
        }
        if (siblingIndent > indent) {
          continue
        }
        // A leading "- " starts a list item: going down it is the next item,
        // going up it is the first key of this one.
        if (step === 1 && sibling[2]) {
          break
        }
        if (sibling[4] === 'name') {
          found.add(k)
        }
        if (step === -1 && sibling[2]) {
          break
        }
      }
    }
  })
  return found
}

function scanYaml(file, lines) {
  const nameLines = elementIconNameLines(lines)
  const consumed = new Set()
  const stack = []

  const handleValue = ({ lineIndex, value, col, indent, labelIndent }) => {
    const label = labelIndent === undefined ? undefined : findLabel(lines, lineIndex, labelIndent)
    const trimmed = value.trim()
    consumed.add(lineIndex)

    if (BLOCK_SCALAR_RE.test(trimmed)) {
      const body = []
      for (let k = lineIndex + 1; k < lines.length; k += 1) {
        if (lines[k].trim() && indentOf(lines[k]) <= indent) {
          break
        }
        body.push(k)
        consumed.add(k)
      }
      const firstLine = body.find((k) => lines[k].trim())
      if (firstLine === undefined) {
        return
      }
      if (!lines[firstLine].trim().startsWith('=')) {
        const name = lines[firstLine].trim()
        if (NAME_RE.test(name)) {
          record({ name, file, lineIndex: firstLine, col: lines[firstLine].indexOf(name), line: lines[firstLine], kind: 'literal', label })
        }
        return
      }
      let count = 0
      for (const k of body) {
        for (const literal of expressionLiterals(lines[k], 0)) {
          record({ ...literal, file, lineIndex: k, line: lines[k], kind: 'expression', label })
          count += 1
        }
      }
      if (count === 0) {
        result.dynamic.push({ file, line: firstLine + 1, context: cleanContext(lines[firstLine]) })
      }
      return
    }

    if (trimmed.startsWith('{')) {
      for (const match of value.matchAll(/\b(left|right|name|icon)\s*:\s*(['"]?)([a-z0-9]+(?:-[a-z0-9]+)*)\2/g)) {
        const nameCol = col + match.index + match[0].length - match[3].length - match[2].length
        record({ name: match[3], file, lineIndex, col: nameCol, line: lines[lineIndex], kind: 'literal', label })
      }
      return
    }

    const quoted = /^(['"])(.*)\1\s*(#.*)?$/.exec(trimmed)
    const inner = quoted ? quoted[2] : trimmed.replace(/\s+#.*$/, '')
    const innerCol = col + (value.length - value.trimStart().length) + (quoted ? 1 : 0)
    if (inner.startsWith('=')) {
      const literals = expressionLiterals(lines[lineIndex], innerCol)
      literals.forEach((literal) => record({ ...literal, file, lineIndex, line: lines[lineIndex], kind: 'expression', label }))
      if (literals.length === 0) {
        result.dynamic.push({ file, line: lineIndex + 1, context: cleanContext(lines[lineIndex]) })
      }
      return
    }
    if (NAME_RE.test(inner)) {
      record({ name: inner, file, lineIndex, col: innerCol, line: lines[lineIndex], kind: 'literal', label })
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || consumed.has(i)) {
      continue
    }

    const keyMatch = KEY_LINE_RE.exec(line)
    if (keyMatch) {
      const indent = keyMatch[1].length + keyMatch[2].length
      while (stack.length && stack.at(-1).indent >= indent) {
        stack.pop()
      }
      const parent = stack.at(-1)
      const key = keyMatch[4]
      const value = keyMatch[5] ?? ''
      const col = line.length - value.length
      stack.push({ indent, key })

      if (isIconKey(key) || nameLines.has(i)) {
        handleValue({ lineIndex: i, value, col, indent, labelIndent: indent })
        continue
      }
      if (parent && isIconKey(parent.key) && ICON_CHILD_KEYS.has(key)) {
        handleValue({ lineIndex: i, value, col, indent, labelIndent: parent.indent })
        continue
      }
      if (BLOCK_SCALAR_RE.test(value.trim())) {
        for (let k = i + 1; k < lines.length && (!lines[k].trim() || indentOf(lines[k]) > indent); k += 1) {
          scanLooseLine(file, lines, k)
          consumed.add(k)
        }
      }
      scanLooseLine(file, lines, i)
      continue
    }

    const listMatch = LIST_ITEM_RE.exec(line)
    if (listMatch) {
      const indent = listMatch[1].length
      while (stack.length && stack.at(-1).indent > indent) {
        stack.pop()
      }
      const parent = stack.at(-1)
      if (parent && isIconKey(parent.key)) {
        handleValue({ lineIndex: i, value: listMatch[2], col: line.length - listMatch[2].length, indent })
        continue
      }
    }
    scanLooseLine(file, lines, i)
  }
}

// A known Streamline name outside a recognised icon key. Might be an icon fed
// through data or SQL, might be an ordinary word, so the agent decides.
function scanLooseLine(file, lines, lineIndex) {
  const line = lines[lineIndex]
  const candidates = [...line.matchAll(QUOTED_RE)].map((match) => ({ name: match[2], col: match.index + 1 }))
  const plain = /^(\s*(?:-\s+)?(?:[A-Za-z0-9_$.@-]+\s*:\s+)?)([a-z0-9]+(?:-[a-z0-9]+)*)\s*(#.*)?$/.exec(line)
  if (plain && (plain[1].includes(':') || plain[1].trimStart().startsWith('-'))) {
    candidates.push({ name: plain[2], col: plain[1].length })
  }
  for (const { name, col } of candidates) {
    if (!data.mapping[name] && !data.streamline[name]) {
      continue
    }
    if (!name.includes('-') && !/icon/i.test(line)) {
      continue
    }
    const id = `${file}:${lineIndex + 1}:${col}`
    if (recorded.has(id) || data.keep.has(name)) {
      continue
    }
    recorded.add(id)
    result.maybe.push({
      id,
      name,
      file,
      line: lineIndex + 1,
      col,
      context: cleanContext(line),
      suggested: data.mapping[name] ?? null,
      reason: 'Old icon name outside an icon key',
    })
  }
}

function scanCode(file, lines) {
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || /^(\/\/|\/?\*|--)/.test(trimmed)) {
      return
    }
    if (!/icon/i.test(line)) {
      scanLooseLine(file, lines, index)
      return
    }
    for (const literal of expressionLiterals(line, 0)) {
      record({ ...literal, file, lineIndex: index, line, kind: 'expression' })
    }
  })
}

function scanJson(file, lines) {
  lines.forEach((line, index) => {
    const match = JSON_ICON_RE.exec(line)
    if (!match || !isIconKey(match[1])) {
      scanLooseLine(file, lines, index)
      return
    }
    const valueCol = match.index + match[0].length - match[2].length - 1
    if (match[2].startsWith('=')) {
      expressionLiterals(line, valueCol).forEach((literal) =>
        record({ ...literal, file, lineIndex: index, line, kind: 'expression' }),
      )
      return
    }
    if (NAME_RE.test(match[2])) {
      record({ name: match[2], file, lineIndex: index, col: valueCol, line, kind: 'literal' })
    }
  })
}

for (const file of listSolutionFiles(solutionDir)) {
  const lines = readFileSync(join(solutionDir, file), 'utf8').split('\n').map((line) => line.replace(/\r$/, ''))
  if (/\.(jigx|ya?ml)$/.test(file)) {
    scanYaml(file, lines)
  } else if (file.endsWith('.json')) {
    scanJson(file, lines)
  } else {
    scanCode(file, lines)
  }
}

const dir = workDir(solutionDir)
writeJson(join(dir, 'scan.json'), result)

const decisionsPath = join(dir, 'decisions.json')
const decisions = existsSync(decisionsPath)
  ? readJson(decisionsPath)
  : { choices: {}, maybe: {}, notMigrated: [], fromData: [] }
for (const name of Object.keys(result.pending)) {
  decisions.choices[name] ??= { new: null, alternatives: [], confidence: 'high', note: '' }
}
for (const item of result.maybe) {
  decisions.maybe[item.id] ??= null
}
writeJson(decisionsPath, decisions)

const uses = (bucket) => Object.values(bucket).reduce((sum, item) => sum + item.where.length, 0)
console.log(`Scanned ${result.solution}`)
console.log(`  mapped:    ${Object.keys(result.mapped).length} names, ${uses(result.mapped)} uses (from the reference mapping)`)
console.log(`  pending:   ${Object.keys(result.pending).length} names, ${uses(result.pending)} uses (choose a Tabler name)`)
console.log(`  maybe:     ${result.maybe.length} places (decide "icon" or "skip")`)
console.log(`  dynamic:   ${result.dynamic.length} icon expressions without literal names (check for fromData)`)
console.log(`  unchanged: ${Object.keys(result.unchanged).length} names already valid in Tabler`)
for (const [name, item] of Object.entries(result.pending)) {
  const first = item.where[0]
  console.log(`  pending ${name} (${item.where.length}x) ${first.file}:${first.line}${first.label ? ` · ${first.label}` : ''}`)
}
console.log(`Wrote ${join(dir, 'scan.json')} and ${decisionsPath}`)
