import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipText } from '../../../src/host/page/clip-text.ts';

test('keeps a text within the limit as it is', () => {
  assert.equal(clipText('hello', 5), 'hello');
  assert.equal(clipText('', 0), '');
});

test('cuts a longer text to the limit, ellipsis included', () => {
  assert.equal(clipText('hello world', 6), 'hello…');
  assert.equal(clipText('hello world', 6, ''), 'hello ');
});

test('never cuts inside a surrogate pair', () => {
  const text = `${'a'.repeat(118)}😀b`;
  const clipped = clipText(text, 120);
  assert.equal(clipped, `${'a'.repeat(118)}…`);
  // encodeURIComponent throws on a lone surrogate.
  assert.doesNotThrow(() => encodeURIComponent(clipped));
  assert.equal(clipText('😀😀', 3, ''), '😀');
});
