// Browser bundle for a DSH client plugin, after DSH's own packages/client/tsdown.client.ts:
// a CommonJS factory registered through window.__ModuleLoader__, whose shared
// modules come from the Web shell's module table and everything else is inlined.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UserConfig } from 'tsdown'

/** Modules the DSH 0.2 Web shell shares with every plugin bundle (`PLATFORM_MODULES`). */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * DSH packages a bundle may inline: stateless helpers with no runtime identity
 * to share. Any other DSH value import would duplicate a running plugin, so it
 * fails the build; collaborate through Cordis services instead.
 */
const INLINE_SAFE = /^@deepseek-ai\/dsh-util-workspace-path(\/|$)/

interface Manifest {
  readonly name: string
  readonly dsh?: { readonly client?: { readonly external?: readonly string[] } }
}

/**
 * Build `src/client/index.tsx` into `dist/client.cjs`, the `./client` export a
 * package's `dsh.client` declaration points DSH at.
 * @param packageDir - the package directory; its name becomes the module id.
 */
export function clientBundle(packageDir: string): UserConfig {
  const manifest: Manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const shared = new Set([...PLATFORM_MODULES, ...(manifest.dsh?.client?.external ?? [])])
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'dist',
    format: 'cjs',
    // tsdown aims CJS at Node unless the bundler itself is told otherwise.
    inputOptions: { platform: 'browser' },
    dts: false,
    clean: false,
    deps: { neverBundle: [...shared], alwaysBundle: (id) => !shared.has(id), onlyBundle: false },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [
      {
        name: 'dsh-client-purity',
        resolveId(source) {
          if (
            source.startsWith('@deepseek-ai/') &&
            !shared.has(source) &&
            !INLINE_SAFE.test(source)
          ) {
            throw new Error(
              `${manifest.name}: the client bundle cannot inline ${source}; import it as a type`,
            )
          }
          return null
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.cjs',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  }
}
