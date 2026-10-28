/**
 * Keys the agent can press, written the way people write shortcuts: `Enter`,
 * `Control+A`, `Shift+Tab`, `Meta+Shift+K`.
 */

/** A key as CDP's `Input.dispatchKeyEvent` describes it. */
export interface KeyDefinition {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  /** `KeyboardEvent.code`. */
  readonly code: string;
  /** Windows virtual key code, which Chrome uses for shortcuts and editing commands. */
  readonly keyCode: number;
  /** The text the key types without modifiers; empty for keys that type nothing. */
  readonly text: string;
}

export interface KeyPress {
  readonly key: KeyDefinition;
  /** CDP's modifier bit set: Alt 1, Ctrl 2, Meta 4, Shift 8. */
  readonly modifiers: number;
}

const ALT = 1;
const CONTROL = 2;
const META = 4;
const SHIFT = 8;

const MODIFIERS: Readonly<Record<string, number>> = {
  alt: ALT,
  option: ALT,
  control: CONTROL,
  ctrl: CONTROL,
  meta: META,
  cmd: META,
  command: META,
  super: META,
  shift: SHIFT,
};

const NAMED_KEYS: readonly KeyDefinition[] = [
  { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  { key: 'Tab', code: 'Tab', keyCode: 9, text: '' },
  { key: 'Escape', code: 'Escape', keyCode: 27, text: '' },
  { key: 'Backspace', code: 'Backspace', keyCode: 8, text: '' },
  { key: 'Delete', code: 'Delete', keyCode: 46, text: '' },
  { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, text: '' },
  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, text: '' },
  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, text: '' },
  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, text: '' },
  { key: 'Home', code: 'Home', keyCode: 36, text: '' },
  { key: 'End', code: 'End', keyCode: 35, text: '' },
  { key: 'PageUp', code: 'PageUp', keyCode: 33, text: '' },
  { key: 'PageDown', code: 'PageDown', keyCode: 34, text: '' },
  { key: 'Insert', code: 'Insert', keyCode: 45, text: '' },
  ...Array.from({ length: 12 }, (_, index) => ({
    key: `F${index + 1}`,
    code: `F${index + 1}`,
    keyCode: 112 + index,
    text: '',
  })),
];

/** Other names people use for the named keys. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  return: 'Enter',
  esc: 'Escape',
  space: ' ',
  spacebar: ' ',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pgup: 'PageUp',
  pgdn: 'PageDown',
};

/** Punctuation on a US layout: character, code, and virtual key code. */
const PUNCTUATION: readonly (readonly [string, string, number])[] = [
  [',', 'Comma', 188],
  ['.', 'Period', 190],
  ['/', 'Slash', 191],
  [';', 'Semicolon', 186],
  ["'", 'Quote', 222],
  ['[', 'BracketLeft', 219],
  [']', 'BracketRight', 221],
  ['\\', 'Backslash', 220],
  ['-', 'Minus', 189],
  ['=', 'Equal', 187],
  ['`', 'Backquote', 192],
];

export class KeyComboError extends Error {
  constructor(combo: string, reason: string) {
    super(`cannot press "${combo}": ${reason}`);
    this.name = 'KeyComboError';
  }
}

/**
 * Reads a shortcut such as `Control+Shift+K`. Modifier names are case-insensitive;
 * a single character names its key, and `+` itself is written as the last part
 * (`Control++`).
 */
export function parseKeyCombo(combo: string): KeyPress {
  const text = combo.trim();
  if (text === '') throw new KeyComboError(combo, 'no key given');
  const parts =
    text === '+'
      ? ['+']
      : text.endsWith('++')
        ? [...text.slice(0, -2).split('+'), '+']
        : text.split('+');
  const keyName = (parts.pop() ?? '').trim();
  if (keyName === '') throw new KeyComboError(combo, 'no key after the modifiers');
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.trim().toLowerCase()];
    if (bit === undefined) throw new KeyComboError(combo, `"${part}" is not a modifier`);
    modifiers |= bit;
  }
  const key = keyDefinition(keyName, (modifiers & SHIFT) !== 0);
  if (key === undefined) throw new KeyComboError(combo, `"${keyName}" is not a key`);
  return { key, modifiers };
}

/** The key's definition, with Shift applied to letters. */
export function keyDefinition(name: string, shift: boolean): KeyDefinition | undefined {
  const alias = KEY_ALIASES[name.toLowerCase()];
  const canonical = alias ?? name;
  const named = NAMED_KEYS.find((key) => key.key.toLowerCase() === canonical.toLowerCase());
  if (named !== undefined) return named;
  if ([...canonical].length !== 1) return undefined;
  if (/^[a-z]$/i.test(canonical)) {
    const upper = canonical.toUpperCase();
    const typed = shift ? upper : canonical.toLowerCase();
    return { key: typed, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: typed };
  }
  if (/^[0-9]$/.test(canonical)) {
    return {
      key: canonical,
      code: `Digit${canonical}`,
      keyCode: canonical.charCodeAt(0),
      text: canonical,
    };
  }
  const punctuation = PUNCTUATION.find(([character]) => character === canonical);
  if (punctuation !== undefined) {
    const [character, code, keyCode] = punctuation;
    return { key: character, code, keyCode, text: character };
  }
  // Any other single character types itself, though shortcuts on it may not work.
  return { key: canonical, code: '', keyCode: 0, text: canonical };
}

/** The text a press types: none when Ctrl, Alt or Meta make it a shortcut. */
export function typedText(press: KeyPress): string {
  return (press.modifiers & (ALT | CONTROL | META)) === 0 ? press.key.text : '';
}
