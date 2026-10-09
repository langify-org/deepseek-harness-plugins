#!/usr/bin/env node
/**
 * Keep every README in English, Japanese, and Simplified Chinese in step.
 *
 * For README.md (English), README.ja.md, and README.zh.md in the repository
 * root and in each plugins/<name>/ directory:
 *   - all three files exist;
 *   - they have the same heading structure (count and levels);
 *   - each section's code blocks are identical in all three;
 *   - each section's prose matches the hashes recorded in .i18n.json beside it.
 *
 * The record makes a one-sided edit visible: change a section in one language
 * and the check fails until the other two are brought along and the record is
 * rewritten with `pnpm run docs:record` (`node scripts/i18n.mjs --write`).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LANGS = /** @type {const} */ (['en', 'ja', 'zh'])
const FILES = { en: 'README.md', ja: 'README.ja.md', zh: 'README.zh.md' }
const RECORD = '.i18n.json'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const write = process.argv.includes('--write')

/** Directories whose README must exist in every language. */
function docDirs() {
  const plugins = join(root, 'plugins')
  const dirs = [root]
  for (const entry of readdirSync(plugins, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(join(plugins, entry.name))
  }
  return dirs
}

/**
 * Split Markdown into sections at ATX headings outside fenced code.
 * @returns {{ level: number, title: string, prose: string, code: string[] }[]}
 */
function sections(text) {
  const result = []
  let current = { level: 0, title: '(preamble)', prose: [], code: [] }
  let fence = null
  let block = []
  for (const line of text.split('\n')) {
    const marker = line.match(/^(\s*)(`{3,}|~{3,})/)
    if (fence !== null) {
      block.push(line)
      if (marker && marker[2].startsWith(fence)) {
        current.code.push(block.join('\n'))
        fence = null
        block = []
      }
      continue
    }
    if (marker) {
      fence = marker[2]
      block = [line]
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      result.push(current)
      current = { level: heading[1].length, title: heading[2].trim(), prose: [], code: [] }
      continue
    }
    current.prose.push(line.trimEnd())
  }
  if (fence !== null) throw new Error('unterminated code block')
  result.push(current)
  return result
    .filter((section, index) => index > 0 || section.prose.join('').trim() !== '' || section.code.length > 0)
    .map((section) => ({ ...section, prose: section.prose.join('\n').trim() }))
}

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** Check one directory; returns problems, and the record to write when there are none. */
function checkDir(dir) {
  const where = relative(root, dir) || '.'
  const problems = []
  const parsed = {}
  for (const lang of LANGS) {
    const file = join(dir, FILES[lang])
    if (!existsSync(file)) {
      problems.push(`${where}: ${FILES[lang]} is missing`)
      continue
    }
    try {
      parsed[lang] = sections(readFileSync(file, 'utf8'))
    } catch (error) {
      problems.push(`${where}/${FILES[lang]}: ${error.message}`)
    }
  }
  if (problems.length > 0) return { problems }

  const shape = (lang) => parsed[lang].map((section) => section.level).join(',')
  for (const lang of ['ja', 'zh']) {
    if (shape(lang) !== shape('en')) {
      const titles = (l) => parsed[l].map((s) => `${'#'.repeat(s.level)} ${s.title}`).join(' | ')
      problems.push(`${where}: ${FILES[lang]} has a different heading structure than README.md\n    en: ${titles('en')}\n    ${lang}: ${titles(lang)}`)
    }
  }
  if (problems.length > 0) return { problems }

  const record = parsed.en.map((section, index) => {
    for (const lang of ['ja', 'zh']) {
      const other = parsed[lang][index]
      if (JSON.stringify(other.code) !== JSON.stringify(section.code)) {
        problems.push(`${where}: code blocks of section "${section.title}" differ between README.md and ${FILES[lang]} (code stays identical in every language)`)
      }
    }
    return { section: section.title, ...Object.fromEntries(LANGS.map((lang) => [lang, hash(parsed[lang][index].prose)])) }
  })
  if (problems.length > 0) return { problems }
  if (write) return { problems, record }

  const recordFile = join(dir, RECORD)
  if (!existsSync(recordFile)) return { problems: [`${where}: ${RECORD} is missing; run pnpm run docs:record after translating`] }
  const recorded = JSON.parse(readFileSync(recordFile, 'utf8')).sections ?? []
  if (recorded.length !== record.length) {
    return { problems: [`${where}: sections were added or removed since ${RECORD} was written; update every language, then run pnpm run docs:record`] }
  }
  record.forEach((current, index) => {
    const saved = recorded[index]
    const changed = LANGS.filter((lang) => saved[lang] !== current[lang])
    if (changed.length === 0) return
    const stale = LANGS.filter((lang) => !changed.includes(lang))
    const hint =
      stale.length > 0
        ? `changed in ${changed.join(', ')} only; bring ${stale.map((lang) => FILES[lang]).join(', ')} along`
        : 'changed in every language'
    problems.push(`${where}: section "${current.section}" ${hint}, then run pnpm run docs:record`)
  })
  return { problems }
}

let failed = false
for (const dir of docDirs()) {
  const { problems, record } = checkDir(dir)
  for (const problem of problems) console.error(`i18n: ${problem}`)
  if (problems.length > 0) {
    failed = true
    continue
  }
  if (write && record) {
    const file = join(dir, RECORD)
    writeFileSync(file, `${JSON.stringify({ note: 'Written by scripts/i18n.mjs --write. Do not edit by hand.', sections: record }, null, 2)}\n`)
    console.log(`i18n: recorded ${relative(root, file)}`)
  }
}
if (failed) process.exitCode = 1
else if (!write) console.log('i18n: README translations are in step')
