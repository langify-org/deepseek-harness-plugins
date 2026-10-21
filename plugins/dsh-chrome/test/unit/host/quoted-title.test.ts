import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotedTitle } from '../../../src/host/page/quoted-title.ts';

test('collapses whitespace and trims the title', () => {
  assert.equal(quotedTitle('  Many\t spaces\n here  '), '"Many spaces here"');
});

test('quotes an empty or blank title as (untitled)', () => {
  assert.equal(quotedTitle(''), '"(untitled)"');
  assert.equal(quotedTitle(' \n\t '), '"(untitled)"');
});

test('keeps a title of 120 characters whole', () => {
  assert.equal(quotedTitle('y'.repeat(120)), `"${'y'.repeat(120)}"`);
});

test('cuts a longer title to 119 characters and an ellipsis', () => {
  assert.equal(quotedTitle('x'.repeat(121)), `"${'x'.repeat(119)}…"`);
  assert.equal(quotedTitle('x'.repeat(300)), `"${'x'.repeat(119)}…"`);
});

test('escapes quotes and backslashes into a JSON string literal', () => {
  const title = 'He said "hello" at C:\\docs';

  assert.equal(quotedTitle(title), '"He said \\"hello\\" at C:\\\\docs"');
});

test('returns a JSON string literal that parses back to the shown text', () => {
  assert.equal(JSON.parse(quotedTitle('  A\nB  ')), 'A B');
  assert.equal(JSON.parse(quotedTitle('')), '(untitled)');
  assert.equal(JSON.parse(quotedTitle('say "hi"')), 'say "hi"');
  assert.equal(JSON.parse(quotedTitle('x'.repeat(200))), `${'x'.repeat(119)}…`);
});
