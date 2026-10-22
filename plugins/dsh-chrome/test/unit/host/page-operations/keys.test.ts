import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  KeyComboError,
  parseKeyCombo,
  typedText,
} from '../../../../src/host/page-operations/keys.ts';

function assertComboError(combo: string, reason: string): void {
  assert.throws(
    () => parseKeyCombo(combo),
    (error: unknown) =>
      error instanceof KeyComboError &&
      error.name === 'KeyComboError' &&
      error.message === `cannot press "${combo}": ${reason}`,
  );
}

test('parses Enter, Tab, and Escape as the named keys', () => {
  assert.deepEqual(parseKeyCombo('Enter'), {
    key: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    modifiers: 0,
  });
  assert.deepEqual(parseKeyCombo('Tab'), {
    key: { key: 'Tab', code: 'Tab', keyCode: 9, text: '' },
    modifiers: 0,
  });
  assert.deepEqual(parseKeyCombo('Escape'), {
    key: { key: 'Escape', code: 'Escape', keyCode: 27, text: '' },
    modifiers: 0,
  });
});

test('parses Space and space as the space key', () => {
  const space = { key: ' ', code: 'Space', keyCode: 32, text: ' ' };
  assert.deepEqual(parseKeyCombo('Space'), { key: space, modifiers: 0 });
  assert.deepEqual(parseKeyCombo('space'), { key: space, modifiers: 0 });
});

test('parses a letter into its key, code, key code, and text', () => {
  assert.deepEqual(parseKeyCombo('a'), {
    key: { key: 'a', code: 'KeyA', keyCode: 65, text: 'a' },
    modifiers: 0,
  });
  assert.deepEqual(parseKeyCombo('Shift+a'), {
    key: { key: 'A', code: 'KeyA', keyCode: 65, text: 'A' },
    modifiers: 8,
  });
});

test('parses a digit into its digit code and key code', () => {
  assert.deepEqual(parseKeyCombo('7'), {
    key: { key: '7', code: 'Digit7', keyCode: 55, text: '7' },
    modifiers: 0,
  });
});

test('parses punctuation into its code and key code', () => {
  assert.deepEqual(parseKeyCombo(','), {
    key: { key: ',', code: 'Comma', keyCode: 188, text: ',' },
    modifiers: 0,
  });
});

test('parses Control+A and keeps the letter itself lowercased', () => {
  assert.deepEqual(parseKeyCombo('Control+A'), {
    key: { key: 'a', code: 'KeyA', keyCode: 65, text: 'a' },
    modifiers: 2,
  });
});

test('parses modifier names case-insensitively into CDP modifier bits', () => {
  assert.deepEqual(parseKeyCombo('ctrl+shift+K'), {
    key: { key: 'K', code: 'KeyK', keyCode: 75, text: 'K' },
    modifiers: 10,
  });
  assert.deepEqual(parseKeyCombo('Meta+Shift+K'), {
    key: { key: 'K', code: 'KeyK', keyCode: 75, text: 'K' },
    modifiers: 12,
  });
  assert.deepEqual(parseKeyCombo('Alt+F4'), {
    key: { key: 'F4', code: 'F4', keyCode: 115, text: '' },
    modifiers: 1,
  });
});

test('parses plus written as the last part of a combination', () => {
  assert.deepEqual(parseKeyCombo('Control++'), {
    key: { key: '+', code: '', keyCode: 0, text: '+' },
    modifiers: 2,
  });
  assert.deepEqual(parseKeyCombo('+'), {
    key: { key: '+', code: '', keyCode: 0, text: '+' },
    modifiers: 0,
  });
});

test('rejects combinations with no key, an unknown modifier, or an unknown key', () => {
  assertComboError('', 'no key given');
  assertComboError('   ', 'no key given');
  assertComboError('Control+', 'no key after the modifiers');
  assertComboError('Hyper+A', '"Hyper" is not a modifier');
  assertComboError('NotAKey', '"NotAKey" is not a key');
});

test('types the key text only when Control, Alt, and Meta are absent', () => {
  assert.equal(typedText(parseKeyCombo('a')), 'a');
  assert.equal(typedText(parseKeyCombo('Shift+a')), 'A');
  assert.equal(typedText(parseKeyCombo('Enter')), '\r');
  assert.equal(typedText(parseKeyCombo('Shift+Tab')), '');
  assert.equal(typedText(parseKeyCombo('Control+A')), '');
  assert.equal(typedText(parseKeyCombo('Alt+F4')), '');
  assert.equal(typedText(parseKeyCombo('Meta+Shift+K')), '');
});
