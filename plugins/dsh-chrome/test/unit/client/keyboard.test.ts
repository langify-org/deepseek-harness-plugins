import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  editInputs,
  isComposing,
  isPasteShortcut,
  type KeyEventLike,
  keyInput,
  keyText,
  modifiersOf,
} from '../../../src/client/viewer/keyboard.ts';

function keyEvent(overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: '',
    code: '',
    keyCode: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  };
}

test('reports a CDP modifier bit for each held modifier', () => {
  assert.equal(modifiersOf(keyEvent()), 0);
  assert.equal(modifiersOf(keyEvent({ altKey: true })), 1);
  assert.equal(modifiersOf(keyEvent({ ctrlKey: true })), 2);
  assert.equal(modifiersOf(keyEvent({ metaKey: true })), 4);
  assert.equal(modifiersOf(keyEvent({ shiftKey: true })), 8);
  assert.equal(
    modifiersOf(keyEvent({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })),
    15,
  );
});

test('treats a composing event or keyCode 229 as an input method at work', () => {
  assert.equal(isComposing(keyEvent({ isComposing: true })), true);
  assert.equal(isComposing(keyEvent({ keyCode: 229 })), true);
  assert.equal(isComposing(keyEvent({ keyCode: 65 })), false);
});

test('recognizes Ctrl+V and Cmd+V unless Alt is held', () => {
  assert.equal(isPasteShortcut(keyEvent({ ctrlKey: true, key: 'v' })), true);
  assert.equal(isPasteShortcut(keyEvent({ metaKey: true, key: 'V' })), true);
  assert.equal(isPasteShortcut(keyEvent({ ctrlKey: true, altKey: true, key: 'v' })), false);
  assert.equal(isPasteShortcut(keyEvent({ ctrlKey: true, key: 'c' })), false);
  assert.equal(isPasteShortcut(keyEvent({ key: 'v' })), false);
});

test('types the character of a printable key', () => {
  assert.equal(keyText(keyEvent({ key: 'a' })), 'a');
  assert.equal(keyText(keyEvent({ key: ' ' })), ' ');
});

test('types a carriage return for Enter', () => {
  assert.equal(keyText(keyEvent({ key: 'Enter', code: 'Enter', keyCode: 13 })), '\r');
});

test('types nothing for a Ctrl or Cmd shortcut or a named key', () => {
  assert.equal(keyText(keyEvent({ key: 'v', ctrlKey: true })), '');
  assert.equal(keyText(keyEvent({ key: 'v', metaKey: true })), '');
  assert.equal(keyText(keyEvent({ key: 'ArrowLeft' })), '');
  assert.equal(keyText(keyEvent({ key: 'Shift' })), '');
});

test('counts a non-BMP character as one typed character', () => {
  assert.equal(keyText(keyEvent({ key: '😀' })), '😀');
});

test('builds a key input for a press and an empty-text release', () => {
  const pressed = keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, shiftKey: true });
  assert.deepEqual(keyInput(pressed, 'down'), {
    kind: 'key',
    action: 'down',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    text: 'a',
    modifiers: 8,
    repeat: false,
  });
  assert.deepEqual(keyInput(pressed, 'up'), {
    kind: 'key',
    action: 'up',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    text: '',
    modifiers: 8,
    repeat: false,
  });
});

test('inserts typed text and replacement text as finished text', () => {
  assert.deepEqual(editInputs('insertText', 'hello'), [{ kind: 'text', text: 'hello' }]);
  assert.deepEqual(editInputs('insertReplacementText', 'fixed'), [{ kind: 'text', text: 'fixed' }]);
  assert.deepEqual(editInputs('insertText', null), []);
  assert.deepEqual(editInputs('insertText', ''), []);
});

test('sends Enter down with a carriage return and then Enter up for a line break', () => {
  const enter = [
    {
      kind: 'key',
      action: 'down',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      text: '\r',
      modifiers: 0,
      repeat: false,
    },
    {
      kind: 'key',
      action: 'up',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      text: '',
      modifiers: 0,
      repeat: false,
    },
  ];
  assert.deepEqual(editInputs('insertLineBreak', null), enter);
  assert.deepEqual(editInputs('insertParagraph', null), enter);
});

test('sends Backspace for a backward deletion', () => {
  assert.deepEqual(editInputs('deleteContentBackward', null), [
    {
      kind: 'key',
      action: 'down',
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
      text: '',
      modifiers: 0,
      repeat: false,
    },
    {
      kind: 'key',
      action: 'up',
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
      text: '',
      modifiers: 0,
      repeat: false,
    },
  ]);
});

test('sends Delete for a forward deletion', () => {
  assert.deepEqual(editInputs('deleteContentForward', null), [
    {
      kind: 'key',
      action: 'down',
      key: 'Delete',
      code: 'Delete',
      keyCode: 46,
      text: '',
      modifiers: 0,
      repeat: false,
    },
    {
      kind: 'key',
      action: 'up',
      key: 'Delete',
      code: 'Delete',
      keyCode: 46,
      text: '',
      modifiers: 0,
      repeat: false,
    },
  ]);
});

test('leaves an edit the viewer does not handle alone', () => {
  assert.equal(editInputs('formatBold', null), undefined);
});
