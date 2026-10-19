#!/usr/bin/env node
// Searches the bundled Tabler outline set by name and tags.
// Usage: node find.mjs <word> [<word> ...]   Prints up to 25 names per word.
import { loadData } from './lib.mjs'

const { tabler } = loadData()
const words = process.argv.slice(2).map((word) => word.toLowerCase())
if (!words.length) {
  console.error('Usage: node find.mjs <word> [<word> ...]')
  process.exit(1)
}

for (const word of words) {
  const exact = []
  const prefix = []
  const contains = []
  const tagged = []
  for (const [name, [, tags]] of Object.entries(tabler)) {
    if (name === word) {
      exact.push(name)
    } else if (name.startsWith(word)) {
      prefix.push(name)
    } else if (name.includes(word)) {
      contains.push(name)
    } else if (String(tags).toLowerCase().includes(word)) {
      tagged.push(name)
    }
  }
  const names = [...exact, ...prefix, ...contains, ...tagged].slice(0, 25)
  console.log(`${word}: ${names.length ? names.join(', ') : '(none)'}`)
}
