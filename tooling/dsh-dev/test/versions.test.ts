import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions } from '../src/versions.ts';

test('orders versions as SemVer does, prereleases before their release', () => {
  // SemVer 2.0's own example, lowest first.
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    const lower = ordered[index - 1] ?? '';
    const higher = ordered[index] ?? '';
    assert.ok(compareVersions(lower, higher) < 0, `${lower} < ${higher}`);
    assert.ok(compareVersions(higher, lower) > 0, `${higher} > ${lower}`);
  }
});

test('compares version cores numerically and ignores build metadata', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.2.1-rc.10', '0.2.1-rc.2') > 0);
  assert.equal(compareVersions('0.2.1-rc.2', '0.2.1-rc.2'), 0);
  assert.equal(compareVersions('1.2.3+build.5', '1.2.3'), 0);
});
