/**
 * Builds the package into dist/: the DSH host plugins and the browser client, which bundles
 * noVNC, with noVNC's license beside it.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '@langify-org/dsh-plugin-build';
import { HOST_ROW_ID } from './src/protocol/settings.ts';

const packageDir = fileURLToPath(new URL('.', import.meta.url));

await buildPlugin({
  packageDir,
  hostPlugins: [
    { id: HOST_ROW_ID, exportPath: '.', source: 'src/host/index.ts' },
    { id: 'dsh-chrome-tools', exportPath: './tools', source: 'src/host/tools/index.ts' },
    { id: 'dsh-chrome-context', exportPath: './context', source: 'src/host/context/index.ts' },
  ],
  clientModule: { source: 'src/client/index.tsx' },
  optionalHostModules: ['bufferutil', 'utf-8-validate'],
});

// noVNC is MPL-2.0: the client bundle carries its code, so the package carries its license,
// which also covers the code noVNC itself includes.
// The package exports its entry only, `core/rfb.js`; the license is two levels up.
const noVncDir = fileURLToPath(new URL('../', import.meta.resolve('@novnc/novnc')));
const licenses = join(packageDir, 'dist', 'licenses');
await mkdir(licenses, { recursive: true });
await copyFile(join(noVncDir, 'LICENSE.txt'), join(licenses, 'noVNC-LICENSE.txt'));
