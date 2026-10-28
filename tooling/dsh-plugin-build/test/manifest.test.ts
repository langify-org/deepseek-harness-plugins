import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PluginBuildDeclaration } from '../src/declaration.ts';
import { findManifestProblems, type PluginManifest } from '../src/manifest.ts';

const declaration: PluginBuildDeclaration = {
  packageDir: '/package',
  hostPlugins: [
    { id: 'example', exportPath: '.', source: 'src/host/index.ts' },
    { id: 'example-tools', exportPath: './tools', source: 'src/host/tools.ts' },
  ],
  clientModule: { source: 'src/client/index.tsx' },
  nodePrograms: [{ name: 'relay', source: 'src/relay.ts' }],
};

const consistent: PluginManifest = {
  name: '@scope/example',
  version: '1.0.0',
  exports: {
    '.': './dist/host/index.js',
    './tools': './dist/host/tools.js',
    './client': './dist/client.js',
  },
  files: ['dist'],
  peerDependencies: {},
  bundlePatch: './dist/cordis.patch.yml',
  client: { platform: 'web', external: [] },
};

test('accepts a manifest that publishes exactly what the declaration builds', () => {
  assert.deepEqual(findManifestProblems(consistent, declaration), []);
});

test('reports exports that point away from the build output', () => {
  const manifest = {
    ...consistent,
    exports: { ...consistent.exports, './tools': './lib/tools.js' },
  };
  assert.deepEqual(findManifestProblems(manifest, declaration), [
    'exports["./tools"] must be "./dist/host/tools.js", found "./lib/tools.js"',
  ]);
});

test('requires a root host plugin when the package has a client module', () => {
  const withoutRoot: PluginBuildDeclaration = {
    ...declaration,
    hostPlugins: declaration.hostPlugins.filter((plugin) => plugin.exportPath !== '.'),
  };
  const problems = findManifestProblems(consistent, withoutRoot);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /must declare a host plugin at export path "\."/);
});

test('reports a missing bundle patch, client platform, and published dist', () => {
  const manifest: PluginManifest = {
    ...consistent,
    files: [],
    bundlePatch: './cordis.patch.yml',
    client: { platform: 'node', external: [] },
  };
  assert.deepEqual(findManifestProblems(manifest, declaration), [
    'dsh.bundle.patch must be "./dist/cordis.patch.yml", found "./cordis.patch.yml"',
    'dsh.client.platform must be "web" for a package with a client module',
    'files must include "dist" so the build output is published',
  ]);
});

test('rejects duplicate host plugin ids and malformed program names', () => {
  const duplicated: PluginBuildDeclaration = {
    ...declaration,
    hostPlugins: [...declaration.hostPlugins, { id: 'example', exportPath: './x', source: 'x.ts' }],
    nodePrograms: [{ name: 'Relay', source: 'src/relay.ts' }],
  };
  const manifest = { ...consistent, exports: { ...consistent.exports, './x': './dist/host/x.js' } };
  assert.deepEqual(findManifestProblems(manifest, duplicated), [
    'host plugin id "example" is declared twice',
    'node program name "Relay" must be lowercase kebab-case',
  ]);
});
