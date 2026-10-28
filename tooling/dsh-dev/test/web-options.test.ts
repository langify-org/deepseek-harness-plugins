import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEV_PORT, webOptions } from '../src/web-options.ts';

test('serves on the development port, not dsh web’s default, when no port is given', () => {
  assert.deepEqual(webOptions([]), ['--port', String(DEV_PORT)]);
  assert.deepEqual(webOptions(['--no-open']), ['--no-open', '--port', String(DEV_PORT)]);
  assert.notEqual(DEV_PORT, 3080);
});

test('keeps a port the user gives, in either form', () => {
  assert.deepEqual(webOptions(['--port', '3391']), ['--port', '3391']);
  assert.deepEqual(webOptions(['--port=0', '--no-open']), ['--port=0', '--no-open']);
});
