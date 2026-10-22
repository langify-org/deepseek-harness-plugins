import assert from 'node:assert/strict';
import { test } from 'node:test';
import { typingOf } from '../../../../src/client/screen/typing.ts';

test('types ASCII text, line breaks and tabs as key presses', () => {
  assert.deepEqual(typingOf('Hi!\n\t'), {
    kind: 'keys',
    keysyms: [0x48, 0x69, 0x21, 0xff0d, 0xff09],
  });
  assert.deepEqual(typingOf(''), { kind: 'keys', keysyms: [] });
});

test('types one character of any script as its keysym, as a person types it', () => {
  assert.deepEqual(typingOf('é'), { kind: 'keys', keysyms: [0xe9] });
  assert.deepEqual(typingOf('語'), { kind: 'keys', keysyms: [0x1008a9e] });
  assert.deepEqual(typingOf('😀'), { kind: 'keys', keysyms: [0x101f600] });
});

test('pastes longer text with any character beyond the keymap, whole', () => {
  assert.deepEqual(typingOf('日本語'), { kind: 'paste', text: '日本語' });
  assert.deepEqual(typingOf('café'), { kind: 'paste', text: 'café' });
  assert.deepEqual(typingOf('a\r\nb'), { kind: 'paste', text: 'a\r\nb' });
});
