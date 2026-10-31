import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../tsdown.client.ts'

const config: UserConfig[] = [
  // Host half, loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/host/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
  clientBundle(import.meta.dirname),
  // VS Code extension, packaged into extension/dsh-code-bridge.vsix by the build script.
  {
    entry: { extension: 'src/extension/index.ts' },
    outDir: 'extension/dist',
    format: 'cjs',
    platform: 'node',
    dts: false,
    deps: {
      neverBundle: ['vscode'],
      alwaysBundle: (id) => id !== 'vscode' && !isBuiltin(id),
      onlyBundle: false,
    },
    outputOptions: { entryFileNames: 'extension.js' },
  },
]

export default config
