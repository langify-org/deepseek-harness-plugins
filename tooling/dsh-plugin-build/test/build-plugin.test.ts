import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildPlugin, PluginBuildError } from '../src/build-plugin.ts';
import type { PluginBuildDeclaration } from '../src/declaration.ts';

interface RegisteredModule {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => Record<string, unknown>;
}

let packageDir = '';

const manifest = {
  name: '@scope/example',
  version: '1.0.0',
  type: 'module',
  exports: {
    '.': './dist/host/index.js',
    './client': './dist/client.js',
  },
  files: ['dist'],
  peerDependencies: { '@deepseek-ai/dsh-tools': '0.2.1-rc.2' },
  dsh: {
    bundle: { patch: './dist/cordis.patch.yml' },
    client: { platform: 'web' },
  },
};

const sources: Record<string, string> = {
  'src/host/index.ts': `
    import { greeting } from '../shared/greeting.ts';
    export const name = 'example';
    export const message = greeting('host');
  `,
  'src/client/index.tsx': `
    import { useState } from 'react';
    import { greeting } from '../shared/greeting.ts';
    export const inject = ['sidebarRightTabs'];
    export const message = greeting('client');
    export function Counter() {
      const [count] = useState(1);
      return <p>{count}</p>;
    }
  `,
  'src/shared/greeting.ts': `export const greeting = (side: string) => 'hello from ' + side;`,
  'src/relay.ts': `import { argv } from 'node:process'; export const args = argv.length;`,
};

const declaration = (): PluginBuildDeclaration => ({
  packageDir,
  hostPlugins: [{ id: 'example', exportPath: '.', source: 'src/host/index.ts' }],
  clientModule: { source: 'src/client/index.tsx' },
  nodePrograms: [{ name: 'relay', source: 'src/relay.ts' }],
});

async function writeFixture(files: Record<string, string>, packageJson: object): Promise<void> {
  await writeFile(join(packageDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(packageDir, path)), { recursive: true });
    await writeFile(join(packageDir, path), content);
  }
}

before(async () => {
  packageDir = await mkdtemp(join(tmpdir(), 'dsh-plugin-build-'));
});

after(async () => {
  await rm(packageDir, { recursive: true, force: true });
});

test('builds host plugins, the client module factory, programs, and the bundle patch', async () => {
  await writeFixture(sources, manifest);
  await buildPlugin(declaration());

  const host = await import(pathToFileURL(join(packageDir, 'dist/host/index.js')).href);
  assert.equal(host.message, 'hello from host');

  const registered: RegisteredModule[] = [];
  const window = { __ModuleLoader__: { load: (row: RegisteredModule) => registered.push(row) } };
  const client = await readFile(join(packageDir, 'dist/client.js'), 'utf8');
  new Function('window', client)(window);
  assert.equal(registered.length, 1);
  assert.equal(registered[0]?.id, '@scope/example');

  const required: string[] = [];
  const exports = registered[0]?.factory((id) => {
    required.push(id);
    return id === 'react' ? { useState: (value: unknown) => [value] } : { jsx: () => null };
  });
  assert.equal(exports?.['message'], 'hello from client');
  assert.deepEqual(exports?.['inject'], ['sidebarRightTabs']);
  assert.deepEqual(required.sort(), ['react', 'react/jsx-runtime']);

  const relay = await readFile(join(packageDir, 'dist/bin/relay.js'), 'utf8');
  assert.match(relay, /node:process/);

  const patch = await readFile(join(packageDir, 'dist/cordis.patch.yml'), 'utf8');
  assert.match(patch, /name: "@scope\/example"/);
});

test('rejects client imports the DSH web client would not provide', async () => {
  await writeFixture(
    {
      ...sources,
      'src/client/index.tsx': `
        import { installConnection } from '@deepseek-ai/dsh-client-connection';
        export const install = installConnection;
      `,
    },
    manifest,
  );
  await assert.rejects(buildPlugin(declaration()), (error: unknown) => {
    assert.ok(error instanceof PluginBuildError);
    assert.deepEqual(error.problems, [
      'client code requires "@deepseek-ai/dsh-client-connection", which the DSH web client does ' +
        'not provide; bundle it, use a type-only import, or list it in dsh.client.external',
    ]);
    return true;
  });
});

test('rejects host imports of DSH packages missing from peerDependencies', async () => {
  await writeFixture(
    {
      ...sources,
      'src/host/index.ts': `
        import { defineTool } from '@deepseek-ai/dsh-tools';
        import { Context } from '@deepseek-ai/cordis';
        export const tool = [defineTool, Context];
      `,
    },
    manifest,
  );
  await assert.rejects(buildPlugin(declaration()), (error: unknown) => {
    assert.ok(error instanceof PluginBuildError);
    assert.deepEqual(error.problems, [
      'host code imports @deepseek-ai/cordis at runtime; declare it in peerDependencies',
    ]);
    return true;
  });
});
