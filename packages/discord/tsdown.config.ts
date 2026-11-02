import type { UserConfig } from 'tsdown'

// Host only. Nothing imports its types, so none are emitted.
const config: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'dist',
  platform: 'node',
  dts: false,
}

export default config
