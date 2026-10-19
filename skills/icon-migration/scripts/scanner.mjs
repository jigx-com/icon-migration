// Finds every icon name in a Jigx solution and sorts it into mapped, pending
// (needs a choice), maybe (needs a yes/no) and unchanged. Shared by scan.mjs
// and verify.mjs.
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { NAME_RE, isValidTabler, listSolutionFiles } from './lib.mjs'

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
const KEYED_LITERAL_BEFORE_RE = /["']?([A-Za-z0-9_]+)["']?\s*:\s*$/
const ITEM_PROPERTY_RE = /@ctx\.current\.item\.([A-Za-z0-9_]+)/g
const JSON_EXTRACT_ICON_RE = /json_extract\s*\(\s*\w+\s*,\s*'\$\.([A-Za-z0-9_]*icon[A-Za-z0-9_]*)'\s*\)/i
const TABLE_REFERENCE_RE = /\[default\/([A-Za-z0-9_]+)\]/

export const isIconKey = (key) => /icon/i.test(key) && !SETTING_KEY_RE.test(key)
const indentOf = (line) => line.length - line.trimStart().length
const cleanContext = (line) => line.trim().slice(0, 140)
const readLines = (path) => readFileSync(path, 'utf8').split('\n').map((line) => line.replace(/\r$/, ''))

// Literals inside an expression. "from" is where the expression starts (after
// its leading "="), so that "=" is not mistaken for a comparison.
function expressionLiterals(line, from) {
  const found = []
  for (const match of line.matchAll(QUOTED_RE)) {
    if (match.index < from) {
      continue
    }
    const before = line.slice(from, match.index).trimEnd()
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

// Tables declared as null in databases/default.jigx are Dynamic Data entities.
function dynamicDataTables(solutionDir, files) {
  const tables = new Set()
  if (!files.includes('databases/default.jigx')) {
    return tables
  }
  for (const line of readLines(join(solutionDir, 'databases/default.jigx'))) {
    const match = /^\s+([A-Za-z0-9_]+):\s*null\s*$/.exec(line)
    if (match) {
      tables.add(match[1])
    }
  }
  return tables
}

// Properties that icon expressions read from list items, for example
// "righticon" in icon: =@ctx.current.item.righticon. Inline data that sets
// those properties holds icon names.
function iconItemProperties(solutionDir, files) {
  const properties = new Set()
  for (const file of files) {
    for (const line of readLines(join(solutionDir, file))) {
      const match = KEY_LINE_RE.exec(line)
      if (!match || !isIconKey(match[4])) {
        continue
      }
      for (const property of (match[5] ?? '').matchAll(ITEM_PROPERTY_RE)) {
        properties.add(property[1].toLowerCase())
      }
    }
  }
  return properties
}

export function scanSolution(solutionDir, data) {
  const knownOld = new Set([...Object.keys(data.mapping), ...Object.keys(data.streamline)])
  const files = listSolutionFiles(solutionDir)
  const dynamicTables = dynamicDataTables(solutionDir, files)
  const itemProperties = iconItemProperties(solutionDir, files)
  const isIconDataKey = (key) => isIconKey(key) || itemProperties.has(key.toLowerCase())

  const result = {
    solution: basename(solutionDir),
    tablerVersion: data.tablerVersion,
    mapped: {},
    pending: {},
    unchanged: {},
    maybe: [],
    dynamic: [],
    fromData: [],
  }
  const recorded = new Set()

  const addWhere = (bucket, name, where) => {
    bucket[name] ??= { where: [] }
    bucket[name].where.push(where)
  }

  const record = ({ name, file, lineIndex, col, line, kind, label }) => {
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

  const recordExpression = ({ file, lines, lineIndexes, from, label }) => {
    let count = 0
    lineIndexes.forEach((k, position) => {
      for (const literal of expressionLiterals(lines[k], position === 0 ? from : 0)) {
        record({ ...literal, file, lineIndex: k, line: lines[k], kind: 'expression', label })
        count += 1
      }
    })
    if (count === 0) {
      result.dynamic.push({ file, line: lineIndexes[0] + 1, context: cleanContext(lines[lineIndexes[0]]) })
    }
  }

  // A known Streamline name outside a recognised icon key. A string set on an
  // icon-like property of inline data is an icon; anything else might be an
  // ordinary word, so the agent decides.
  const scanLooseLine = (file, lines, lineIndex) => {
    const line = lines[lineIndex]
    const candidates = [...line.matchAll(QUOTED_RE)].map((match) => ({ name: match[2], col: match.index + 1 }))
    const plain = /^(\s*(?:-\s+)?(?:[A-Za-z0-9_$.@-]+\s*:\s+)?)([a-z0-9]+(?:-[a-z0-9]+)*)\s*(#.*)?$/.exec(line)
    if (plain && (plain[1].includes(':') || plain[1].trimStart().startsWith('-'))) {
      candidates.push({ name: plain[2], col: plain[1].length })
    }
    for (const { name, col } of candidates) {
      const id = `${file}:${lineIndex + 1}:${col}`
      if (recorded.has(id) || data.keep.has(name)) {
        continue
      }
      const key = KEYED_LITERAL_BEFORE_RE.exec(line.slice(0, col - (line[col - 1] === '"' || line[col - 1] === "'" ? 1 : 0)))
      if (key && isIconDataKey(key[1])) {
        record({ name, file, lineIndex, col, line, kind: 'literal' })
        continue
      }
      if (!data.mapping[name] && !data.streamline[name]) {
        continue
      }
      if (!name.includes('-') && !/icon/i.test(line)) {
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

  const scanFromData = (file, lines) => {
    lines.forEach((line, index) => {
      const match = JSON_EXTRACT_ICON_RE.exec(line)
      if (!match) {
        return
      }
      for (let k = index; k < Math.min(lines.length, index + 40); k += 1) {
        const table = TABLE_REFERENCE_RE.exec(lines[k])
        if (table) {
          const kind = dynamicTables.has(table[1]) ? 'Dynamic Data' : 'local table'
          result.fromData.push({ source: `default/${table[1]} ($.${match[1]}, ${kind})`, file, line: index + 1 })
          return
        }
      }
    })
  }

  const scanYaml = (file, lines) => {
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
          consumed.add(k)
          if (lines[k].trim()) {
            body.push(k)
          }
        }
        if (!body.length) {
          return
        }
        const first = lines[body[0]]
        if (first.trim().startsWith('=')) {
          recordExpression({ file, lines, lineIndexes: body, from: first.indexOf('=') + 1, label })
          return
        }
        const name = first.trim()
        if (NAME_RE.test(name)) {
          record({ name, file, lineIndex: body[0], col: first.indexOf(name), line: first, kind: 'literal', label })
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
        recordExpression({ file, lines, lineIndexes: [lineIndex], from: innerCol + 1, label })
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

  const scanCode = (file, lines) => {
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

  const scanJson = (file, lines) => {
    lines.forEach((line, index) => {
      const match = JSON_ICON_RE.exec(line)
      if (!match || !isIconKey(match[1])) {
        scanLooseLine(file, lines, index)
        return
      }
      const valueCol = match.index + match[0].length - match[2].length - 1
      if (match[2].startsWith('=')) {
        recordExpression({ file, lines, lineIndexes: [index], from: valueCol + 1 })
        return
      }
      if (NAME_RE.test(match[2])) {
        record({ name: match[2], file, lineIndex: index, col: valueCol, line, kind: 'literal' })
      }
    })
  }

  for (const file of files) {
    const lines = readLines(join(solutionDir, file))
    scanFromData(file, lines)
    if (/\.(jigx|ya?ml)$/.test(file)) {
      scanYaml(file, lines)
    } else if (file.endsWith('.json')) {
      scanJson(file, lines)
    } else {
      scanCode(file, lines)
    }
  }

  return result
}
