/**
 * Builds the package into dist/: the DSH host plugin and browser client, the native
 * host relay, and the connector extension that Chrome loads unpacked.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '@langify-org/dsh-plugin-build';
import { build } from 'esbuild';
import packageJson from './package.json' with { type: 'json' };
import { CONNECTOR_EXTENSION_KEY } from './src/protocol/connector-identity.ts';

const packageDir = fileURLToPath(new URL('.', import.meta.url));

await buildPlugin({
  packageDir,
  hostPlugins: [
    { id: 'dsh-chrome', exportPath: '.', source: 'src/host/index.ts' },
    { id: 'dsh-chrome-tools', exportPath: './tools', source: 'src/host/tools/index.ts' },
    { id: 'dsh-chrome-context', exportPath: './context', source: 'src/host/context/index.ts' },
  ],
  clientModule: { source: 'src/client/index.tsx' },
  nodePrograms: [{ name: 'native-host', source: 'src/native-host/relay.ts' }],
  optionalHostModules: ['bufferutil', 'utf-8-validate'],
});

await buildConnectorExtension(join(packageDir, 'dist', 'extension'));

/** The connector: a Manifest V3 extension with one service worker. */
async function buildConnectorExtension(outdir: string): Promise<void> {
  await mkdir(outdir, { recursive: true });
  await build({
    absWorkingDir: packageDir,
    entryPoints: ['src/extension/service-worker.ts'],
    outfile: join(outdir, 'service-worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    // Module service workers, storage.session and promise-based chrome.debugger are all
    // present by Chrome 120, the minimum the manifest declares.
    target: 'chrome120',
    sourcemap: 'linked',
    logLevel: 'warning',
  });
  const manifest = {
    manifest_version: 3,
    name: 'dsh-chrome connector',
    description:
      'Lets DeepSeek Harness show and operate the pages it opens in this Chrome profile.',
    version: packageJson.version,
    key: CONNECTOR_EXTENSION_KEY,
    minimum_chrome_version: '120',
    permissions: ['debugger', 'nativeMessaging', 'storage', 'tabs', 'tabGroups'],
    background: { service_worker: 'service-worker.js', type: 'module' },
  };
  await writeFile(join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
