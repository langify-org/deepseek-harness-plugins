import type { ViewerInput } from '../../protocol/viewer.ts';
import type { Log } from '../runtime/log.ts';
import type { ChromePage } from '../runtime/pages.ts';

/**
 * Delivers a viewer's input to a page as trusted CDP input events, in arrival order.
 *
 * Mouse moves are coalesced: while one is waiting, a newer move replaces it, so a fast
 * pointer never queues more than one move behind the events that matter.
 */
export class PageInput {
  readonly #page: ChromePage;
  readonly #log: Log;
  #queue: Promise<void> = Promise.resolve();
  #waitingMove: Extract<ViewerInput, { kind: 'mouse' }> | undefined;

  constructor(page: ChromePage, log: Log) {
    this.#page = page;
    this.#log = log;
  }

  dispatch(input: ViewerInput): void {
    if (input.kind === 'mouse' && input.action === 'move') {
      const alreadyWaiting = this.#waitingMove !== undefined;
      this.#waitingMove = input;
      if (alreadyWaiting) return;
      this.#enqueue(() => {
        const move = this.#waitingMove;
        this.#waitingMove = undefined;
        return move === undefined ? Promise.resolve() : this.#deliver(move);
      });
      return;
    }
    this.#enqueue(() => this.#deliver(input));
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(task).catch((error: unknown) => {
      this.#log.warn(`dsh-chrome: input was not delivered: ${String(error)}`);
    });
  }

  async #deliver(input: ViewerInput): Promise<void> {
    const page = this.#page;
    switch (input.kind) {
      case 'mouse':
        await page.send('Input.dispatchMouseEvent', {
          type: MOUSE_EVENT_TYPES[input.action],
          x: input.x,
          y: input.y,
          button: input.button,
          buttons: input.buttons,
          clickCount: input.clickCount,
          modifiers: input.modifiers,
        });
        return;
      case 'wheel':
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
          modifiers: input.modifiers,
        });
        return;
      case 'key':
        await page.send(
          'Input.dispatchKeyEvent',
          input.action === 'down'
            ? {
                // `keyDown` also types the key's text; `rawKeyDown` presses a key that types none.
                type: input.text === '' ? 'rawKeyDown' : 'keyDown',
                key: input.key,
                code: input.code,
                windowsVirtualKeyCode: input.keyCode,
                nativeVirtualKeyCode: input.keyCode,
                modifiers: input.modifiers,
                autoRepeat: input.repeat,
                isKeypad: input.code.startsWith('Numpad'),
                ...(input.text === '' ? {} : { text: input.text, unmodifiedText: input.text }),
              }
            : {
                type: 'keyUp',
                key: input.key,
                code: input.code,
                windowsVirtualKeyCode: input.keyCode,
                nativeVirtualKeyCode: input.keyCode,
                modifiers: input.modifiers,
              },
        );
        return;
      case 'text':
        await page.send('Input.insertText', { text: input.text });
        return;
    }
  }
}

const MOUSE_EVENT_TYPES = {
  move: 'mouseMoved',
  down: 'mousePressed',
  up: 'mouseReleased',
} as const;
