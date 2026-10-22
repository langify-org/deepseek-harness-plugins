import type { Readable, Writable } from 'node:stream';

/** A carrier of CDP messages: JSON text in each direction. */
export interface CdpTransport {
  send(message: string): void;
  onMessage(listener: (message: string) => void): void;
  /** Runs once the carrier closes, with why; immediately if it already has. */
  onClose(listener: (reason: Error) => void): void;
  close(): void;
}

/**
 * The pipe Chrome speaks CDP on when started with `--remote-debugging-pipe`: it reads
 * messages on its file descriptor 3 and writes on 4, each a JSON text ended by a NUL byte.
 * Only the process that started Chrome holds these ends, so no other process can reach the
 * browser through them.
 */
export class PipeTransport implements CdpTransport {
  readonly #input: Writable;
  readonly #messageListeners: ((message: string) => void)[] = [];
  readonly #closeListeners: ((reason: Error) => void)[] = [];
  #closedBy: Error | undefined;
  #buffered = '';

  /**
   * @param input - what Chrome reads (its file descriptor 3).
   * @param output - what Chrome writes (its file descriptor 4).
   */
  constructor(input: Writable, output: Readable) {
    this.#input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => this.#receive(chunk));
    output.once('close', () => this.#close(new Error('Chrome closed its debugging pipe')));
    // Writing after Chrome exited fails; the close above reports that.
    input.on('error', () => {});
    output.on('error', () => {});
  }

  send(message: string): void {
    if (this.#closedBy !== undefined) return;
    this.#input.write(`${message}\0`);
  }

  onMessage(listener: (message: string) => void): void {
    this.#messageListeners.push(listener);
  }

  onClose(listener: (reason: Error) => void): void {
    if (this.#closedBy !== undefined) listener(this.#closedBy);
    else this.#closeListeners.push(listener);
  }

  close(): void {
    this.#input.end();
    this.#close(new Error('the debugging pipe was closed'));
  }

  #receive(chunk: string): void {
    this.#buffered += chunk;
    for (let end = this.#buffered.indexOf('\0'); end !== -1; end = this.#buffered.indexOf('\0')) {
      const message = this.#buffered.slice(0, end);
      this.#buffered = this.#buffered.slice(end + 1);
      for (const listener of this.#messageListeners) listener(message);
    }
  }

  #close(reason: Error): void {
    if (this.#closedBy !== undefined) return;
    this.#closedBy = reason;
    for (const listener of this.#closeListeners.splice(0)) listener(reason);
  }
}
