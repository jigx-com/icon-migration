#!/usr/bin/env node
// Checks the current solution files for icon names the app will not render:
// old Streamline names and anything that is not a Tabler outline icon, in icon
// positions only. Exits 1 when it finds any.
import { loadData, solutionDirFromArgs } from './lib.mjs'
import { scanSolution } from './scanner.mjs'

const solutionDir = solutionDirFromArgs(process.argv.slice(2))
const result = scanSolution(solutionDir, loadData())

const leftovers = [
  ...Object.entries(result.mapped).map(([name, item]) => ({ name, item, hint: `reference pick: ${item.new}` })),
  ...Object.entries(result.pending).map(([name, item]) => ({ name, item, hint: 'not a Tabler outline icon' })),
]

if (!leftovers.length) {
  console.log(`No leftover icon names in ${result.solution}.`)
  if (result.maybe.length) {
    console.log(`${result.maybe.length} strings outside icon keys still look like old names; check them if unsure:`)
    result.maybe.forEach((item) => console.log(`  ${item.file}:${item.line} ${item.name}`))
  }
  process.exit(0)
}

console.log(`Leftover icon names in ${result.solution}:`)
for (const { name, item, hint } of leftovers) {
  console.log(`  ${name} (${hint})`)
  item.where.forEach((where) => console.log(`    ${where.file}:${where.line}`))
}
process.exit(1)
