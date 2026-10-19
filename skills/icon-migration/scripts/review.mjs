#!/usr/bin/env node
// Builds .icon-migration/review.html with the Tabler set, the old pictures and
// this solution's result built in, then opens it. Pass --no-open to skip opening.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL_DIR, fail, loadData, readJson, solutionDirFromArgs, workDir, writeJson } from './lib.mjs'

const argv = process.argv.slice(2)
const solutionDir = solutionDirFromArgs(argv)
const dir = workDir(solutionDir)
const resultPath = join(dir, 'icon-migration.json')
const cachePath = join(dir, 'old-svg-cache.json')
const data = loadData()

if (!existsSync(resultPath)) {
  fail('no .icon-migration/icon-migration.json. Run apply.mjs first.')
}
const result = readJson(resultPath)
const cache = existsSync(cachePath) ? readJson(cachePath) : {}

// Old pictures not bundled with the skill come from the icon server, the same
// place old app versions download them from. Missing pictures are not fatal.
async function fetchOldSvg(name) {
  if (name in cache) {
    return cache[name]
  }
  try {
    const response = await fetch(`https://images.jigx.com/icons/${name.slice(0, 2)}/${name}.svg`, {
      signal: AbortSignal.timeout(5000),
    })
    cache[name] = response.ok ? await response.text() : null
  } catch {
    cache[name] = null
  }
  return cache[name]
}

const missing = result.icons.filter((item) => !data.streamline[item.old] && !item.oldSvg)
for (let index = 0; index < missing.length; index += 8) {
  await Promise.all(
    missing.slice(index, index + 8).map(async (item) => {
      const svg = await fetchOldSvg(item.old)
      if (svg) {
        item.oldSvg = svg
      }
    }),
  )
}
writeJson(cachePath, cache)

// "</" would end the surrounding <script> tag early.
const embed = (value) => JSON.stringify(value).replace(/<\//g, '<\\/')
const template = readFileSync(join(SKILL_DIR, 'assets', 'review.template.html'), 'utf8')
const html = template
  .split('__TABLER_JSON__')
  .join(embed(data.tabler))
  .split('__STREAMLINE_JSON__')
  .join(embed(data.streamline))
  .split('__RESULT_JSON__')
  .join(embed(result))
const pagePath = join(dir, 'review.html')
writeFileSync(pagePath, html)
console.log(`Wrote ${pagePath}`)

if (!argv.includes('--no-open')) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [pagePath]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', pagePath]]
        : ['xdg-open', [pagePath]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => console.log(`Could not open a browser. Open ${pagePath} yourself.`))
  child.unref()
}
