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
  /** Why the pipe no longer works, once it does not. */
  #failure: Error | undefined;

  constructor(chrome: ChildProcess) {
    const input = chrome.stdio[3] as Writable | null;
    const output = chrome.stdio[4] as Readable | null;
    if (input === null || output === null) {
      throw new Error('Chrome started without its debugging pipe');
    }
    this.#input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => this.#receive(chunk));
    // A Chrome that exits, or never starts, breaks the pipe; callers learn it from their calls.
    const fail = (reason: string) => this.#rejectAll(new Error(reason));
    input.on('error', (error) => fail(`Chrome's debugging pipe failed: ${error.message}`));
    output.on('error', (error) => fail(`Chrome's debugging pipe failed: ${error.message}`));
    chrome.once('error', (error) => fail(`Chrome could not start: ${error.message}`));
    chrome.once('exit', () => fail('Chrome exited'));
  }

  /** Sends one CDP command, to the browser or to the page of a flat session. */
  call(method: string, params: object, sessionId?: string): Promise<unknown> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const message =
        sessionId === undefined ? { id, method, params } : { id, method, params, sessionId };
      this.#input.write(`${JSON.stringify(message)}\0`);
    });
  }

  #rejectAll(failure: Error): void {
    this.#failure ??= failure;
    for (const pending of this.#pending.values()) pending.reject(failure);
    this.#pending.clear();
  }

  #receive(chunk: string): void {
    this.#buffered += chunk;
    for (let end = this.#buffered.indexOf('\0'); end !== -1; end = this.#buffered.indexOf('\0')) {
      const text = this.#buffered.slice(0, end);
      this.#buffered = this.#buffered.slice(end + 1);
      let message: unknown;
      try {
        message = JSON.parse(text);
      } catch {
        // Thrown from a stream listener, the error would end DSH; the pipe is useless anyway.
        this.#rejectAll(new Error("Chrome's debugging pipe sent a message that is not JSON"));
        return;
      }
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
