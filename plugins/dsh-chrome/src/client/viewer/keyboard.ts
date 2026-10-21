import type { Modifiers, ViewerInput } from '../../protocol/viewer.ts';

/** The parts of a keyboard event the viewer reads. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
}

export function modifiersOf(
  event: Pick<KeyEventLike, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): Modifiers {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

/**
 * Whether an input method is composing text. Its key events belong to the composition;
 * the finished text arrives with `compositionend`.
 */
export function isComposing(event: Pick<KeyEventLike, 'isComposing' | 'keyCode'>): boolean {
  // Chrome reports keyCode 229 for keys an input method consumes.
  return event.isComposing || event.keyCode === 229;
}

/** Ctrl+V or Cmd+V: left to the browser, so that a `paste` event carries the clipboard. */
export function isPasteShortcut(event: KeyEventLike): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v';
}

/**
 * The text a key types: its character, unless Ctrl or Cmd turns it into a shortcut.
 * Enter types a carriage return, which is what Chrome expects for form submission.
 */
export function keyText(event: KeyEventLike): string {
  if (event.ctrlKey || event.metaKey) return '';
  if (event.key === 'Enter') return '\r';
  return [...event.key].length === 1 ? event.key : '';
}

/**
 * The input for an edit a text field reports through `beforeinput`, or `undefined` for
 * edits the viewer leaves alone. Phone keyboards report typing this way instead of
 * with key events: words as inserted text, Enter and deletions as edits.
 */
export function editInputs(inputType: string, data: string | null): ViewerInput[] | undefined {
  switch (inputType) {
    case 'insertText':
    case 'insertReplacementText':
      return data ? [{ kind: 'text', text: data }] : [];
    case 'insertLineBreak':
    case 'insertParagraph':
      return keyPress('Enter', 'Enter', 13, '\r');
    case 'deleteContentBackward':
      return keyPress('Backspace', 'Backspace', 8, '');
    case 'deleteContentForward':
      return keyPress('Delete', 'Delete', 46, '');
    default:
      return undefined;
  }
}

/** A key pressed and released without modifiers. */
function keyPress(key: string, code: string, keyCode: number, text: string): ViewerInput[] {
  const base = { kind: 'key', key, code, keyCode, modifiers: 0, repeat: false } as const;
  return [
    { ...base, action: 'down', text },
    { ...base, action: 'up', text: '' },
  ];
}

export function keyInput(event: KeyEventLike, action: 'down' | 'up'): ViewerInput {
  return {
    kind: 'key',
    action,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    text: action === 'down' ? keyText(event) : '',
    modifiers: modifiersOf(event),
    repeat: event.repeat,
  };
}
