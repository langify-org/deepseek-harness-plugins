/**
 * Keys, as X knows them: keysyms. The screen's X server (Xvnc) presses whichever of its keys
 * carries the keysym, so a key arrives as the character or function it is on the user's own
 * keyboard, whatever its layout.
 */

/** The keysyms dsh-chrome sends by name. */
export const KEYSYM = {
  BackSpace: 0xff08,
  Tab: 0xff09,
  Return: 0xff0d,
  Escape: 0xff1b,
  CapsLock: 0xffe5,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  SuperLeft: 0xffeb,
  SuperRight: 0xffec,
  /** AltGr: the third character of a key. */
  Level3Shift: 0xfe03,
  /** The letter V, for the paste shortcut. */
  V: 0x76,
} as const;

/** The modifiers: held around shortcuts, and let go of around text typed as text. */
export const MODIFIER_KEYSYMS: ReadonlySet<number> = new Set([
  KEYSYM.ShiftLeft,
  KEYSYM.ShiftRight,
  KEYSYM.ControlLeft,
  KEYSYM.ControlRight,
  KEYSYM.AltLeft,
  KEYSYM.AltRight,
  KEYSYM.SuperLeft,
  KEYSYM.SuperRight,
  KEYSYM.Level3Shift,
]);

/** A key event, as far as its routing depends on it. */
export interface KeyLike {
  /** `KeyboardEvent.key`: the character the key types, or the key's name. */
  readonly key: string;
  /** `KeyboardEvent.code`: the physical key, which tells left from right. */
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  /** Whether AltGr is held (`getModifierState('AltGraph')`), which chooses a key's third character. */
  readonly altGraph: boolean;
}

/** Where the user's keyboard is: on macOS, ⌘ plays Ctrl's part, and Option chooses characters. */
export interface KeyboardPlatform {
  readonly mac: boolean;
}

/** What a key press becomes on the screen. */
export type KeyRouting =
  /** The keysym, pressed now and released with the key. */
  | { readonly kind: 'key'; readonly keysym: number }
  /** The character, typed without the modifiers held: AltGr or Option chose it. */
  | { readonly kind: 'character'; readonly character: string }
  /** The paste shortcut. */
  | { readonly kind: 'paste' }
  /** Nothing: an input method's key or a dead key, whose text comes as text once composed. */
  | { readonly kind: 'none' };

/** The keysyms of named keys. */
const NAMED_KEYSYMS: Readonly<Record<string, number>> = {
  Backspace: KEYSYM.BackSpace,
  Tab: KEYSYM.Tab,
  Enter: KEYSYM.Return,
  Pause: 0xff13,
  ScrollLock: 0xff14,
  Escape: KEYSYM.Escape,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  PrintScreen: 0xff61,
  Insert: 0xff63,
  ContextMenu: 0xff67,
  NumLock: 0xff7f,
  CapsLock: KEYSYM.CapsLock,
  Delete: 0xffff,
  AltGraph: KEYSYM.Level3Shift,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
};

/** The modifiers' keysyms, left and right. */
const MODIFIER_KEYS: Readonly<Record<string, readonly [left: number, right: number]>> = {
  Shift: [KEYSYM.ShiftLeft, KEYSYM.ShiftRight],
  Control: [KEYSYM.ControlLeft, KEYSYM.ControlRight],
  Alt: [KEYSYM.AltLeft, KEYSYM.AltRight],
  Meta: [KEYSYM.SuperLeft, KEYSYM.SuperRight],
};

/** The character each key of a US keyboard types, for shortcuts on layouts without Latin letters. */
const US_CHARACTERS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  Space: ' ',
};

/**
 * What a key press becomes on the screen:
 *
 * - a named key or a modifier, its keysym (⌘ as Ctrl on macOS);
 * - with Ctrl (⌘ on macOS), or Alt elsewhere, a shortcut: the key's character, or on a layout
 *   without Latin letters the US key's, so that Ctrl+C copies on a Russian keyboard too;
 * - with AltGr, or Option on macOS, the character it chose, typed as such;
 * - else the character's keysym;
 * - an input method's key or a dead key, nothing: its text comes once composed.
 */
export function routeKey(event: KeyLike, platform: KeyboardPlatform): KeyRouting {
  const modifier = MODIFIER_KEYS[event.key];
  if (modifier !== undefined) {
    if (event.key === 'Meta' && platform.mac) return { kind: 'key', keysym: KEYSYM.ControlLeft };
    return { kind: 'key', keysym: event.code.endsWith('Right') ? modifier[1] : modifier[0] };
  }
  const named = NAMED_KEYSYMS[event.key];
  if (named !== undefined) return { kind: 'key', keysym: named };
  const character = singleCharacter(event.key);
  if (character === undefined) return { kind: 'none' };
  const command = event.ctrlKey || (platform.mac && event.metaKey);
  const shortcut = !event.altGraph && (command || (event.altKey && !platform.mac));
  if (shortcut) {
    const latin = isPrintableAscii(character) ? character : usCharacterOf(event.code);
    if (latin === undefined) return { kind: 'none' };
    if (command && !event.altKey && latin.toLowerCase() === 'v') return { kind: 'paste' };
    return { kind: 'key', keysym: keysymOfCharacter(latin) };
  }
  if (event.altGraph || (platform.mac && event.altKey)) return { kind: 'character', character };
  return { kind: 'key', keysym: keysymOfCharacter(character) };
}

/**
 * The keysym of a character: its code point for Latin-1 (where keysyms and Unicode agree),
 * else the Unicode keysym.
 */
export function keysymOfCharacter(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  const latin1 =
    (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff);
  return latin1 ? codePoint : 0x1000000 + codePoint;
}

/** Whether the character is on every keyboard's keys: printable ASCII. */
export function isPrintableAscii(character: string): boolean {
  return character.length === 1 && character >= ' ' && character <= '~';
}

/** The key's text when it is one character, which may take two UTF-16 units. */
function singleCharacter(key: string): string | undefined {
  const characters = [...key];
  return characters.length === 1 ? characters[0] : undefined;
}

function usCharacterOf(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return US_CHARACTERS[code];
}
