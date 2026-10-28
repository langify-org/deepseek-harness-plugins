import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  KEYSYM,
  type KeyLike,
  keysymOfCharacter,
  routeKey,
} from '../../../../src/client/screen/keysyms.ts';

const LINUX = { mac: false };
const MAC = { mac: true };

function press(key: string, code = '', held: Partial<Omit<KeyLike, 'key' | 'code'>> = {}): KeyLike {
  return { key, code, ctrlKey: false, metaKey: false, altKey: false, altGraph: false, ...held };
}

test('presses printable ASCII as the keysym of its character, whatever the layout typed it', () => {
  assert.deepEqual(routeKey(press('a', 'KeyA'), LINUX), { kind: 'key', keysym: 0x61 });
  assert.deepEqual(routeKey(press('A', 'KeyA'), LINUX), { kind: 'key', keysym: 0x41 });
  // On a French keyboard, the key US calls Q types A.
  assert.deepEqual(routeKey(press('a', 'KeyQ'), LINUX), { kind: 'key', keysym: 0x61 });
  assert.deepEqual(routeKey(press(' ', 'Space'), LINUX), { kind: 'key', keysym: 0x20 });
});

test("presses a character beyond ASCII as its own keysym: Latin-1's code, else Unicode's", () => {
  assert.deepEqual(routeKey(press('é', 'Digit2'), LINUX), { kind: 'key', keysym: 0xe9 });
  assert.deepEqual(routeKey(press('ф', 'KeyA'), LINUX), { kind: 'key', keysym: 0x1000444 });
  assert.equal(keysymOfCharacter('😀'), 0x101f600);
});

test('presses named keys, and tells the left modifier from the right', () => {
  assert.deepEqual(routeKey(press('Enter', 'Enter'), LINUX), {
    kind: 'key',
    keysym: KEYSYM.Return,
  });
  assert.deepEqual(routeKey(press('ArrowDown'), LINUX), { kind: 'key', keysym: 0xff54 });
  assert.deepEqual(routeKey(press('F12'), LINUX), { kind: 'key', keysym: 0xffc9 });
  assert.deepEqual(routeKey(press('Shift', 'ShiftRight'), LINUX), {
    kind: 'key',
    keysym: KEYSYM.ShiftRight,
  });
  assert.deepEqual(routeKey(press('Meta', 'MetaLeft'), LINUX), {
    kind: 'key',
    keysym: KEYSYM.SuperLeft,
  });
  assert.deepEqual(routeKey(press('AltGraph', 'AltRight'), LINUX), {
    kind: 'key',
    keysym: KEYSYM.Level3Shift,
  });
});

test('presses Ctrl for ⌘ on macOS, so that its shortcuts work as there', () => {
  assert.deepEqual(routeKey(press('Meta', 'MetaLeft'), MAC), {
    kind: 'key',
    keysym: KEYSYM.ControlLeft,
  });
  assert.deepEqual(routeKey(press('l', 'KeyL', { metaKey: true }), MAC), {
    kind: 'key',
    keysym: 0x6c,
  });
});

test('presses a shortcut by the US key on a layout without Latin letters', () => {
  // Ctrl+C on a Russian keyboard.
  assert.deepEqual(routeKey(press('с', 'KeyC', { ctrlKey: true }), LINUX), {
    kind: 'key',
    keysym: 0x63,
  });
  assert.deepEqual(routeKey(press('ы', 'KeyS', { altKey: true }), LINUX), {
    kind: 'key',
    keysym: 0x73,
  });
  assert.deepEqual(routeKey(press('.', 'Slash', { ctrlKey: true }), LINUX), {
    kind: 'key',
    keysym: 0x2e,
  });
});

test('takes Ctrl+V and ⌘V for the paste shortcut, and Ctrl+Alt+V for a plain shortcut', () => {
  assert.deepEqual(routeKey(press('v', 'KeyV', { ctrlKey: true }), LINUX), { kind: 'paste' });
  assert.deepEqual(routeKey(press('м', 'KeyV', { ctrlKey: true }), LINUX), { kind: 'paste' });
  assert.deepEqual(routeKey(press('v', 'KeyV', { metaKey: true }), MAC), { kind: 'paste' });
  assert.deepEqual(routeKey(press('v', 'KeyV', { ctrlKey: true, altKey: true }), LINUX), {
    kind: 'key',
    keysym: 0x76,
  });
});

test('types the character AltGr or Option chose, rather than a shortcut', () => {
  // AltGr+Q on a German keyboard, which Windows reports with Ctrl held.
  assert.deepEqual(
    routeKey(press('@', 'KeyQ', { ctrlKey: true, altKey: true, altGraph: true }), LINUX),
    { kind: 'character', character: '@' },
  );
  assert.deepEqual(routeKey(press('å', 'KeyA', { altKey: true }), MAC), {
    kind: 'character',
    character: 'å',
  });
});

test("sends nothing for an input method's keys and dead keys, whose text comes composed", () => {
  for (const key of ['Process', 'Dead', 'Unidentified', 'Convert', 'HankakuZenkaku']) {
    assert.deepEqual(routeKey(press(key), LINUX), { kind: 'none' }, key);
  }
});
