// Every English document (X.md) needs its Japanese (X.ja.md) and Chinese (X.zh.md) translations.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './plugins.ts'

const languages = ['ja', 'zh']
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\n')
  .filter((file) => file !== '' && !file.startsWith('.github/') && existsSync(join(root, file)))
const english = files.filter((file) => !languages.some((lang) => file.endsWith(`.${lang}.md`)))
const missing = english.flatMap((file) =>
  languages
    .map((lang) => file.replace(/\.md$/, `.${lang}.md`))
    .filter((translation) => !files.includes(translation)),
)
if (missing.length > 0) {
  console.error(`missing translations:\n${missing.map((file) => `  ${file}`).join('\n')}`)
  process.exit(1)
}
console.log(`docs: ${english.length} document(s) translated into ${languages.join(', ')}`)
