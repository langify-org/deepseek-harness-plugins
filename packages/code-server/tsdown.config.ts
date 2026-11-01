import { execFile } from 'node:child_process'
import { createRequire, isBuiltin } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../tsdown.client.ts'

const config: UserConfig[] = [
  // Host half, loaded by DSH's Loader. Nothing imports its types, so none are emitted.
  { entry: { index: 'src/host/index.ts' }, outDir: 'dist', platform: 'node', dts: false },
  clientBundle(import.meta.dirname),
  // VS Code extension, packaged into extension/dsh-code-bridge.vsix after every
  // build, also in watch mode, where the plugin installs a changed VSIX into the
  // next editor window it opens.
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
    onSuccess: async (_config, signal) => {
      // By path: `pnpm exec` does not put this package's binaries on PATH.
      const vsce = createRequire(import.meta.url).resolve('@vscode/vsce/vsce')
      await promisify(execFile)(
        process.execPath,
        [vsce, 'package', '--no-dependencies', '--skip-license', '--out', 'dsh-code-bridge.vsix'],
        { cwd: join(import.meta.dirname, 'extension'), signal },
      )
    },
  },
]

export default config
