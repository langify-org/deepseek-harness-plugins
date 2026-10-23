import { readFile } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';

/** X protocol request opcodes (the X Window System Protocol, chapter 9). */
const GET_GEOMETRY = 14;
const TRANSLATE_COORDINATES = 40;
const SET_INPUT_FOCUS = 42;
const GET_INPUT_FOCUS = 43;
/** SetInputFocus's revert-to: when the window goes, the focus goes to its parent. */
const REVERT_TO_PARENT = 2;
const CURRENT_TIME = 0;
/** GetInputFocus's answers that are not a window. */
const NO_WINDOW = 0;
const POINTER_ROOT = 1;
/** Every message the server sends is this long, a reply's or an event's data aside. */
const MESSAGE_BYTES = 32;
const GENERIC_EVENT = 35;
/** How long the server may take to answer a request, or the connection. */
const ANSWER_TIMEOUT_MS = 5000;

const X_ERRORS: Readonly<Record<number, string>> = {
  2: 'Value',
  3: 'Window',
  8: 'Match',
};

/** An X server refused a request. */
export class XError extends Error {
  readonly code: number;

  constructor(code: number, request: string) {
    super(`the X server refused ${request}: ${X_ERRORS[code] ?? `error ${code}`}`);
    this.name = 'XError';
    this.code = code;
  }
}

/** A window's place on the screen, in device pixels. */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Pending {
  readonly sequence: number;
  readonly name: string;
  readonly expectsReply: boolean;
  resolve(reply: Buffer | undefined): void;
  reject(error: Error): void;
}

/**
 * The host's own connection to the screen's X server, for what the window manager and Chrome
 * do not say: which window has the keyboard focus, where a window is, and giving the focus to
 * a window. It speaks the few requests it needs of the X protocol, in the client's byte order.
 */
export class XConnection {
  readonly #socket: Socket;
  readonly #root: number;
  readonly #pending: Pending[] = [];
  readonly #closeListeners = new Set<(error: Error) => void>();
  #sequence = 0;
  #buffered: Buffer = Buffer.alloc(0);
  #closedBy: Error | undefined;

  private constructor(socket: Socket, root: number, rest: Buffer) {
    this.#socket = socket;
    this.#root = root;
    socket.on('data', (chunk: Buffer) => this.#receive(chunk));
    socket.on('error', (error) => this.#close(error));
    socket.on('close', () => this.#close(new Error('the X connection closed')));
    if (rest.length > 0) this.#receive(rest);
  }

  /**
   * Connects to the display, as any X program does, with the display's cookie.
   * @param display - the display's name, `:N`.
   * @param authorityPath - the X authority file with the display's cookie.
   * @param socketPath - where the X server listens; the display's socket by default.
   */
  static async connect(
    display: string,
    authorityPath: string,
    socketPath = displaySocketPath(display),
  ): Promise<XConnection> {
    const cookie = cookieOf(await readFile(authorityPath));
    const socket = createConnection(socketPath);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('error', reject);
      });
      socket.write(setupRequest(cookie));
      const { root, rest } = await readSetup(socket);
      return new XConnection(socket, root, rest);
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }

  /** The window that has the keyboard focus, or undefined when none does. */
  async inputFocus(): Promise<number | undefined> {
    const request = Buffer.alloc(4);
    request[0] = GET_INPUT_FOCUS;
    request.writeUInt16LE(1, 2);
    const reply = await this.#request(request, 'GetInputFocus', true);
    const window = reply.readUInt32LE(8);
    return window === NO_WINDOW || window === POINTER_ROOT ? undefined : window;
  }

  /**
   * Gives the window the keyboard focus, as the window manager does, and returns once the
   * server did.
   * @throws an {@link XError} when the window is gone or not shown.
   */
  async focus(window: number): Promise<void> {
    const request = Buffer.alloc(12);
    request[0] = SET_INPUT_FOCUS;
    request[1] = REVERT_TO_PARENT;
    request.writeUInt16LE(3, 2);
    request.writeUInt32LE(window, 4);
    request.writeUInt32LE(CURRENT_TIME, 8);
    // A request with an answer after it: the server answers in order, so its refusal of the
    // first comes before. Both are awaited, so that neither failure goes unhandled.
    await Promise.all([this.#request(request, 'SetInputFocus', false), this.inputFocus()]);
  }

  /**
   * Where the window is on the screen, in device pixels.
   * @throws an {@link XError} when the window is gone.
   */
  async boundsOf(window: number): Promise<WindowBounds> {
    const geometry = Buffer.alloc(8);
    geometry[0] = GET_GEOMETRY;
    geometry.writeUInt16LE(2, 2);
    geometry.writeUInt32LE(window, 4);
    const translate = Buffer.alloc(16);
    translate[0] = TRANSLATE_COORDINATES;
    translate.writeUInt16LE(4, 2);
    translate.writeUInt32LE(window, 4);
    translate.writeUInt32LE(this.#root, 8);
    const [size, position] = await Promise.all([
      this.#request(geometry, 'GetGeometry', true),
      this.#request(translate, 'TranslateCoordinates', true),
    ]);
    return {
      x: position.readInt16LE(12),
      y: position.readInt16LE(14),
      width: size.readUInt16LE(16),
      height: size.readUInt16LE(18),
    };
  }

  /** Whether the connection is closed, by either side. */
  get closed(): boolean {
    return this.#closedBy !== undefined;
  }

  /** Listens to the connection closing, once; at once if it has. */
  onClose(listener: (error: Error) => void): () => void {
    if (this.#closedBy !== undefined) {
      listener(this.#closedBy);
      return () => {};
    }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  close(): void {
    this.#close(new Error('the X connection was closed'));
  }

  #request(request: Buffer, name: string, expectsReply: true): Promise<Buffer>;
  #request(request: Buffer, name: string, expectsReply: false): Promise<undefined>;
  #request(request: Buffer, name: string, expectsReply: boolean): Promise<Buffer | undefined> {
    if (this.#closedBy !== undefined) return Promise.reject(this.#closedBy);
    this.#sequence = (this.#sequence + 1) & 0xffff;
    const sequence = this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#close(new Error(`the X server did not answer ${name} in ${ANSWER_TIMEOUT_MS} ms`));
      }, ANSWER_TIMEOUT_MS);
      timer.unref();
      this.#pending.push({
        sequence,
        name,
        expectsReply,
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#socket.write(request);
    });
  }

  #receive(chunk: Buffer): void {
    this.#buffered = Buffer.concat([this.#buffered, chunk]);
    while (this.#buffered.length >= MESSAGE_BYTES) {
      const kind = this.#buffered[0] ?? 0;
      const extra =
        kind === 1 || (kind & 0x7f) === GENERIC_EVENT ? 4 * this.#buffered.readUInt32LE(4) : 0;
      if (this.#buffered.length < MESSAGE_BYTES + extra) return;
      const message = this.#buffered.subarray(0, MESSAGE_BYTES + extra);
      this.#buffered = this.#buffered.subarray(MESSAGE_BYTES + extra);
      // Events are not asked for; any that come are passed over.
      if (kind === 0 || kind === 1) this.#answer(message.readUInt16LE(2), message);
    }
  }

  /** Settles the request the answer is to, and those before it, which had no answer due. */
  #answer(sequence: number, message: Buffer): void {
    while (this.#pending.length > 0) {
      const pending = this.#pending[0] as Pending;
      if (pending.sequence !== sequence) {
        this.#pending.shift();
        if (pending.expectsReply)
          pending.reject(new Error(`the X server did not answer ${pending.name}`));
        else pending.resolve(undefined);
        continue;
      }
      this.#pending.shift();
      if (message[0] === 0) pending.reject(new XError(message[1] ?? 0, pending.name));
      else pending.resolve(message);
      return;
    }
  }

  #close(error: Error): void {
    if (this.#closedBy !== undefined) return;
    this.#closedBy = error;
    this.#socket.destroy();
    for (const pending of this.#pending.splice(0)) pending.reject(error);
    for (const listener of [...this.#closeListeners]) listener(error);
    this.#closeListeners.clear();
  }
}

/** The Unix socket of a local display, `:N`, as X programs find it. */
export function displaySocketPath(display: string): string {
  const number = /^:(\d+)$/.exec(display)?.[1];
  if (number === undefined) throw new Error(`not a local display: ${display}`);
  return `/tmp/.X11-unix/X${number}`;
}

/** The cookie of an X authority file's first entry. */
export function cookieOf(file: Buffer): { name: Buffer; data: Buffer } {
  let offset = 2;
  const field = () => {
    const length = file.readUInt16BE(offset);
    const value = file.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    return value;
  };
  field(); // address
  field(); // display number
  return { name: Buffer.from(field()), data: Buffer.from(field()) };
}

function setupRequest(cookie: { name: Buffer; data: Buffer }): Buffer {
  const pad = (length: number) => Buffer.alloc((4 - (length % 4)) % 4);
  const header = Buffer.alloc(12);
  header.write('l', 0, 'latin1');
  header.writeUInt16LE(11, 2);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(cookie.name.length, 6);
  header.writeUInt16LE(cookie.data.length, 8);
  return Buffer.concat([
    header,
    cookie.name,
    pad(cookie.name.length),
    cookie.data,
    pad(cookie.data.length),
  ]);
}

/**
 * Reads the server's answer to the connection: the first screen's root window.
 * @throws when the server refuses the connection, closes it, or does not answer in time.
 */
function readSetup(socket: Socket): Promise<{ root: number; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let answer: Buffer = Buffer.alloc(0);
    const stop = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const fail = (error: Error) => {
      stop();
      reject(error);
    };
    const onError = (error: Error) => fail(error);
    const onClose = () => fail(new Error('the X server closed the connection before answering it'));
    const timer = setTimeout(
      () =>
        fail(new Error(`the X server did not answer the connection in ${ANSWER_TIMEOUT_MS} ms`)),
      ANSWER_TIMEOUT_MS,
    );
    const onData = (chunk: Buffer) => {
      answer = Buffer.concat([answer, chunk]);
      if (answer.length < 8) return;
      const length = 8 + 4 * answer.readUInt16LE(6);
      if (answer.length < length) return;
      stop();
      if (answer[0] !== 1) {
        const reason = answer.subarray(8, 8 + (answer[1] ?? 0)).toString('latin1');
        reject(new Error(`the X server refused the connection: ${reason}`));
        return;
      }
      const vendorLength = answer.readUInt16LE(24);
      const formats = answer[29] ?? 0;
      const screens = 40 + vendorLength + ((4 - (vendorLength % 4)) % 4) + 8 * formats;
      resolve({ root: answer.readUInt32LE(screens), rest: answer.subarray(length) });
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}
