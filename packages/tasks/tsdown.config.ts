import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../tsdown.client.ts'

const config: UserConfig[] = [
  // Host half, loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/host/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
  clientBundle(import.meta.dirname),
]

export default config
