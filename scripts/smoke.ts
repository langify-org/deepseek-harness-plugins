// Installs every plugin package into a throwaway DSH home and checks that
// DSH composes each bundle layer. Calls no model API.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginPackages } from './plugins.ts'

const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))
const env = { ...process.env, DSH_HOME: home }
try {
  const plugins = pluginPackages()
  for (const { dir } of plugins) {
    execFileSync('dsh', ['plugin', '--profile', 'web', 'add', `link:${dir}`], {
      env,
      stdio: 'inherit',
    })
  }
  const config = execFileSync('dsh', ['--profile', 'web', '--dump-config'], {
    env,
    encoding: 'utf8',
  })
  const missing = plugins.filter(({ name }) => !config.includes(`\n# == ${name}\n`))
  if (missing.length > 0) {
    throw new Error(`bundle layers not composed: ${missing.map(({ name }) => name).join(', ')}`)
  }
  console.log(`smoke: ${plugins.length} bundle layer(s) composed`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
