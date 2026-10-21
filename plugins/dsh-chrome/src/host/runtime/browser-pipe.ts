import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * Chrome's end of `--remote-debugging-pipe`: CDP messages as JSON, each followed by a NUL
 * byte, on the child's file descriptors 3 (to Chrome) and 4 (from Chrome).
 *
 * The pipe belongs to whoever started Chrome; no other process can reach it. Commands for
 * a page go to the flat session `Target.attachToTarget` returned for it.
 */
export class BrowserPipe {
  readonly #input: Writable;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;
  #buffered = '';

  constructor(chrome: ChildProcess) {
    const input = chrome.stdio[3] as Writable | null;
    const output = chrome.stdio[4] as Readable | null;
    if (input === null || output === null) {
      throw new Error('Chrome started without its debugging pipe');
    }
    this.#input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => this.#receive(chunk));
    chrome.once('exit', () => {
      for (const pending of this.#pending.values()) pending.reject(new Error('Chrome exited'));
      this.#pending.clear();
    });
  }

  /** Sends one CDP command, to the browser or to the page of a flat session. */
  call(method: string, params: object, sessionId?: string): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const message =
        sessionId === undefined ? { id, method, params } : { id, method, params, sessionId };
      this.#input.write(`${JSON.stringify(message)}\0`);
    });
  }

  #receive(chunk: string): void {
    this.#buffered += chunk;
    for (let end = this.#buffered.indexOf('\0'); end !== -1; end = this.#buffered.indexOf('\0')) {
      const message: unknown = JSON.parse(this.#buffered.slice(0, end));
      this.#buffered = this.#buffered.slice(end + 1);
      if (typeof message !== 'object' || message === null || !('id' in message)) continue; // an event
      const pending = this.#pending.get(Number(message.id));
      if (pending === undefined) continue;
      this.#pending.delete(Number(message.id));
      if ('error' in message) pending.reject(new Error(errorMessage(message.error)));
      else pending.resolve('result' in message ? message.result : undefined);
    }
  }
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : String(error);
}
