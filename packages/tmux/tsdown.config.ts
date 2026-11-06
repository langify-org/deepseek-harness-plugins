import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../tsdown.client.ts'

const client = clientBundle(import.meta.dirname)
// wterm's stylesheet goes in as text, injected by the client: DSH loads one
// file per client bundle.
const css = readFileSync(createRequire(import.meta.url).resolve('@wterm/dom/css'), 'utf8')
client.define = { ...client.define, WTERM_CSS: JSON.stringify(css) }

const config: UserConfig[] = [
  // Host half, loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/host/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
  client,
]

export default config
