import { isPrintableAscii, KEYSYM, keysymOfCharacter } from './keysyms.ts';

/**
 * How text the user typed reaches the screen. Characters on every keymap's keys (printable
 * ASCII, line breaks, tabs) are pressed as keys, and so is a single character, as its keysym.
 * Longer text with any other character, such as what a Japanese input method composed, is
 * pasted: handed to the screen as its clipboard, then pasted with Ctrl+V.
 *
 * Keys would not do for such text: the X server gives a character outside its keymap a spare
 * key, and reuses its few spare keys in turn, so a burst of new characters takes a key back
 * before Chrome reads its first press, which then arrives as another character. One
 * character at a time, as a person types, leaves Chrome the time to read each.
 */
export type Typing =
  | { readonly kind: 'keys'; readonly keysyms: readonly number[] }
  | { readonly kind: 'paste'; readonly text: string };

export function typingOf(text: string): Typing {
  const characters = [...text];
  if (characters.length === 1 && characters[0] !== undefined) {
    const character = characters[0];
    if (character === '\n') return { kind: 'keys', keysyms: [KEYSYM.Return] };
    if (character === '\t') return { kind: 'keys', keysyms: [KEYSYM.Tab] };
    // A control character is no text to type.
    if (character < ' ') return { kind: 'keys', keysyms: [] };
    return { kind: 'keys', keysyms: [keysymOfCharacter(character)] };
  }
  const keysyms: number[] = [];
  for (const character of characters) {
    if (character === '\n') keysyms.push(KEYSYM.Return);
    else if (character === '\t') keysyms.push(KEYSYM.Tab);
    else if (isPrintableAscii(character)) keysyms.push(character.charCodeAt(0));
    else return { kind: 'paste', text };
  }
  return { kind: 'keys', keysyms };
}
