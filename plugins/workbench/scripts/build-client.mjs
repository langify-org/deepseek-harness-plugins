#!/usr/bin/env node
/**
 * Build lib/client.js, the browser half, in the form DSH's module loader takes:
 *
 *   window.__ModuleLoader__.load({ id: <package name>, factory: (require) => {...} })
 *
 * The bundle is CommonJS inside that factory. Its only runtime requests are
 * modules the Web shell supplies (the platform module table); anything else
 * fails the build, because the browser could not resolve it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild-wasm'

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))

/** DSH 0.2's platform module table (the Web shell's seed). */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])
const allowed = new Set([...PLATFORM_MODULES, ...(pkg.dsh?.client?.external ?? [])])

const result = await esbuild.build({
  entryPoints: [join(pluginDir, 'src/client/index.tsx')],
  bundle: true,
  write: false,
  metafile: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: [...allowed],
  logLevel: 'warning',
  legalComments: 'none',
})

const requested = new Set()
for (const input of Object.values(result.metafile.inputs)) {
  for (const imported of input.imports) if (imported.external) requested.add(imported.path)
}
const unknown = [...requested].filter((name) => !allowed.has(name))
if (unknown.length > 0) {
  console.error(`build-client: the browser cannot resolve ${unknown.join(', ')}; bundle it, or list a DSH client package in dsh.client.external`)
  process.exit(1)
}

const body = result.outputFiles[0].text
const wrapped = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(pkg.name)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')
mkdirSync(join(pluginDir, 'lib'), { recursive: true })
writeFileSync(join(pluginDir, 'lib', 'client.js'), wrapped)
console.log(`build-client: lib/client.js (${wrapped.length} bytes; requires ${[...requested].sort().join(', ')})`)
