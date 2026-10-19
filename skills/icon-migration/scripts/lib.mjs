import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const WORK_DIR_NAME = '.icon-migration'
export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const SCANNED_EXTENSIONS = ['.jigx', '.yaml', '.yml', '.json', '.js', '.ts', '.sql']
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', WORK_DIR_NAME, 'dist', 'build', '.vscode'])
const SKIPPED_FILES = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'icon-migration.json'])

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

export function loadData() {
  const reference = readJson(join(SKILL_DIR, 'data', 'reference-mapping.json'))
  const keep = readJson(join(SKILL_DIR, 'data', 'keep-names.json'))
  const tabler = readJson(join(SKILL_DIR, 'data', 'tabler-outline.json'))
  const streamline = readJson(join(SKILL_DIR, 'data', 'streamline.json'))

  return {
    tablerVersion: reference.tablerVersion,
    mapping: reference.mapping,
    check: new Set(reference.check),
    keep: new Set([...keep.flags, ...keep.markers, ...keep.placeholderAnimations]),
    tabler,
    streamline,
  }
}

export function isValidTabler(data, name) {
  return Object.prototype.hasOwnProperty.call(data.tabler, name) && !name.endsWith('-filled')
}

export function workDir(solutionDir) {
  return join(solutionDir, WORK_DIR_NAME)
}

export function solutionDirFromArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  const dir = resolve(positional[0] ?? '.')
  if (!existsSync(dir)) {
    fail(`Solution folder not found: ${dir}`)
  }
  return dir
}

export function listSolutionFiles(root) {
  const files = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          visit(join(dir, entry.name))
        }
        continue
      }
      if (SKIPPED_FILES.has(entry.name)) {
        continue
      }
      if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        files.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
      }
    }
  }
  visit(root)
  return files.sort()
}

export function hash(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function fail(message) {
  console.error(`icon-migration: ${message}`)
  process.exit(1)
}
