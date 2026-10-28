import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderBundlePatch } from '../src/bundle-patch.ts';

test('writes one Loader row per host plugin, naming the package root and subpaths', () => {
  const patch = renderBundlePatch('@scope/example', [
    { id: 'example', exportPath: '.', source: 'src/host/index.ts' },
    { id: 'example-tools', exportPath: './tools', source: 'src/host/tools/index.ts' },
  ]);
  assert.equal(
    patch,
    [
      '# Generated from build.ts by @langify-org/dsh-plugin-build. Do not edit.',
      '- insert:',
      '    - id: "example"',
      '      name: "@scope/example"',
      '    - id: "example-tools"',
      '      name: "@scope/example/tools"',
      '',
    ].join('\n'),
  );
});
