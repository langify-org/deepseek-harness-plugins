import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../../../src/host/index.ts';

test("by default, pages open in dsh-chrome's own Chrome, out of sight, and the user's is left alone", () => {
  // What DSH passes when the user sets nothing; the schema's type names only what it returns.
  const config = Config({} as Config);
  assert.equal(config.defaultProfile, 'dedicated');
  assert.equal(config.dedicatedProfile.enabled, true);
  assert.equal(config.dedicatedProfile.display, 'virtual');
  assert.equal(config.dedicatedProfile.shareNativeHosts, true);
  assert.equal(config.dailyProfile.enabled, false);
});
