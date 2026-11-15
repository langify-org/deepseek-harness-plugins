import type { UserConfig } from 'tsdown'

const config: UserConfig[] = [
  // Loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
]

export default config
