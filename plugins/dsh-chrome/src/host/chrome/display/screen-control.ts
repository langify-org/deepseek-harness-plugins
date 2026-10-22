import { createConnection, type Socket } from 'node:net';

/** How long Xvnc may take to answer a change of the screen's size. */
const RESIZE_TIMEOUT_MS = 5000;

// RFB message types and encodings (RFC 6143, and the ExtendedDesktopSize extension).
const CLIENT_SET_ENCODINGS = 2;
const CLIENT_UPDATE_REQUEST = 3;
const CLIENT_SET_DESKTOP_SIZE = 251;
const SERVER_FRAMEBUFFER_UPDATE = 0;
const SERVER_COLOUR_MAP = 1;
const SERVER_BELL = 2;
const SERVER_CUT_TEXT = 3;
const ENCODING_RAW = 0;
const ENCODING_DESKTOP_SIZE = -223;
const ENCODING_EXTENDED_DESKTOP_SIZE = -308;
/** In an ExtendedDesktopSize update, the reason that says this client asked for the change. */
const REASON_THIS_CLIENT = 1;
const RESIZE_REFUSALS: Readonly<Record<number, string>> = {
  1: 'the server does not allow it',
  2: 'the server is out of resources',
  3: 'the screen layout is invalid',
};

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The host's own VNC connection to the screen, through which it sets the screen's size:
 * the protocol's SetDesktopSize, which Xvnc applies by resizing its screen as RandR would.
 * It asks for no pixels, only a pixel at a time when it needs Xvnc's answer.
 */
export class ScreenControl {
  readonly #socket: Socket;
  readonly #reader: Reader;
  #size: ScreenSize = { width: 0, height: 0 };
  #screenId = 0;
  #bytesPerPixel = 4;
  /** Who waits for the next layout Xvnc reports: `reason` says why it changed. */
  #layoutWaiter:
    | {
        /** Takes the layout and returns true, or returns false to wait for the next. */
        offer(reason: number, status: number): boolean;
        fail(error: Error): void;
      }
    | undefined;
  #queue: Promise<void> = Promise.resolve();
  #closedBy: Error | undefined;

  private constructor(socket: Socket) {
    this.#socket = socket;
    this.#reader = new Reader(socket);
  }

  /** Connects, and learns the screen's layout. */
  static async connect(socketPath: string): Promise<ScreenControl> {
    const socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    const control = new ScreenControl(socket);
    try {
      await control.#handshake();
    } catch (error) {
      socket.destroy();
      throw error;
    }
    void control.#readMessages();
    // The layout comes with the first update after ExtendedDesktopSize is announced.
    try {
      await control.#nextLayout(() => true, 'Xvnc did not report its screen layout');
    } catch (error) {
      control.close();
      throw error;
    }
    return control;
  }

  get size(): ScreenSize {
    return this.#size;
  }

  /** Sets the screen's size, in device pixels; changes are applied one after another. */
  resize(size: ScreenSize): Promise<void> {
    const run = this.#queue.then(() => this.#resize(size));
    this.#queue = run.catch(() => {});
    return run;
  }

  close(): void {
    this.#socket.destroy();
  }

  async #handshake(): Promise<void> {
    const version = (await this.#reader.read(12)).toString('latin1');
    if (!version.startsWith('RFB 003.'))
      throw new Error(`not a VNC server: ${JSON.stringify(version)}`);
    this.#socket.write('RFB 003.008\n');
    const count = (await this.#reader.read(1))[0] ?? 0;
    if (count === 0) throw new Error(`Xvnc refused the connection: ${await this.#reason()}`);
    const types = [...(await this.#reader.read(count))];
    // Only None is enabled: the socket's directory keeps other users out.
    if (!types.includes(1)) throw new Error(`Xvnc asks for authentication (${types.join(', ')})`);
    this.#socket.write(Buffer.from([1]));
    if ((await this.#reader.read(4)).readUInt32BE(0) !== 0) {
      throw new Error(`Xvnc refused the connection: ${await this.#reason()}`);
    }
    // ClientInit: share the screen with the viewers.
    this.#socket.write(Buffer.from([1]));
    const init = await this.#reader.read(24);
    this.#size = { width: init.readUInt16BE(0), height: init.readUInt16BE(2) };
    this.#bytesPerPixel = Math.max(1, (init[4] ?? 32) / 8);
    await this.#reader.read(init.readUInt32BE(20));
    const encodings = [ENCODING_EXTENDED_DESKTOP_SIZE, ENCODING_DESKTOP_SIZE];
    const message = Buffer.alloc(4 + 4 * encodings.length);
    message[0] = CLIENT_SET_ENCODINGS;
    message.writeUInt16BE(encodings.length, 2);
    for (const [index, encoding] of encodings.entries()) {
      message.writeInt32BE(encoding, 4 + 4 * index);
    }
    this.#socket.write(message);
  }

  async #resize({ width, height }: ScreenSize): Promise<void> {
    if (this.#closedBy !== undefined) throw this.#closedBy;
    if (width === this.#size.width && height === this.#size.height) return;
    const message = Buffer.alloc(24);
    message[0] = CLIENT_SET_DESKTOP_SIZE;
    message.writeUInt16BE(width, 2);
    message.writeUInt16BE(height, 4);
    message[6] = 1;
    message.writeUInt32BE(this.#screenId, 8);
    message.writeUInt16BE(width, 16);
    message.writeUInt16BE(height, 18);
    this.#socket.write(message);
    // Only an update for this client's own request carries the result.
    const status = await this.#nextLayout(
      (reason) => reason === REASON_THIS_CLIENT,
      'Xvnc did not answer the change of the screen size',
    );
    if (status !== 0) {
      throw new Error(
        `Xvnc did not resize the screen: ${RESIZE_REFUSALS[status] ?? `status ${status}`}`,
      );
    }
  }

  /**
   * Waits for the next layout Xvnc reports for a reason `wanted` accepts, asking for an
   * update to get it; resolves with the status the update carries.
   */
  #nextLayout(wanted: (reason: number) => boolean, timeoutMessage: string): Promise<number> {
    if (this.#closedBy !== undefined) return Promise.reject(this.#closedBy);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#layoutWaiter = undefined;
        reject(new Error(timeoutMessage));
      }, RESIZE_TIMEOUT_MS);
      this.#layoutWaiter = {
        offer: (reason, status) => {
          if (!wanted(reason)) return false;
          clearTimeout(timer);
          resolve(status);
          return true;
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.#requestPixel();
    });
  }

  /** Asks for the top left pixel: the update that answers carries any change of the layout. */
  #requestPixel(): void {
    const message = Buffer.alloc(10);
    message[0] = CLIENT_UPDATE_REQUEST;
    message.writeUInt16BE(1, 6);
    message.writeUInt16BE(1, 8);
    this.#socket.write(message);
  }

  async #readMessages(): Promise<void> {
    try {
      for (;;) {
        const type = (await this.#reader.read(1))[0];
        switch (type) {
          case SERVER_FRAMEBUFFER_UPDATE:
            await this.#readUpdate();
            break;
          case SERVER_COLOUR_MAP: {
            const header = await this.#reader.read(5);
            await this.#reader.read(header.readUInt16BE(3) * 6);
            break;
          }
          case SERVER_BELL:
            break;
          case SERVER_CUT_TEXT: {
            const header = await this.#reader.read(7);
            await this.#reader.read(header.readUInt32BE(3));
            break;
          }
          default:
            throw new Error(`Xvnc sent a message this client does not know (${type})`);
        }
      }
    } catch (error) {
      this.#closedBy = error instanceof Error ? error : new Error(String(error));
      this.#layoutWaiter?.fail(this.#closedBy);
      this.#layoutWaiter = undefined;
      this.#socket.destroy();
    }
  }

  async #readUpdate(): Promise<void> {
    const rectangles = (await this.#reader.read(3)).readUInt16BE(1);
    for (let index = 0; index < rectangles; index += 1) {
      const header = await this.#reader.read(12);
      const x = header.readUInt16BE(0);
      const y = header.readUInt16BE(2);
      const width = header.readUInt16BE(4);
      const height = header.readUInt16BE(6);
      const encoding = header.readInt32BE(8);
      if (encoding === ENCODING_RAW) {
        await this.#reader.read(width * height * this.#bytesPerPixel);
      } else if (encoding === ENCODING_EXTENDED_DESKTOP_SIZE) {
        const screens = (await this.#reader.read(4))[0] ?? 0;
        const layout = await this.#reader.read(16 * screens);
        if (screens > 0) this.#screenId = layout.readUInt32BE(0);
        this.#size = { width, height };
        // x is the reason for the change; when this client asked, y is the result.
        if (this.#layoutWaiter?.offer(x, x === REASON_THIS_CLIENT ? y : 0))
          this.#layoutWaiter = undefined;
      } else if (encoding === ENCODING_DESKTOP_SIZE) {
        this.#size = { width, height };
      } else {
        throw new Error(`Xvnc sent an encoding this client did not ask for (${encoding})`);
      }
    }
  }

  async #reason(): Promise<string> {
    const length = (await this.#reader.read(4)).readUInt32BE(0);
    return (await this.#reader.read(length)).toString('utf8');
  }
}

/** Reads a socket's bytes in the sizes asked for, by one reader at a time. */
class Reader {
  #buffered: Buffer = Buffer.alloc(0);
  #waiting:
    | { readonly bytes: number; resolve(data: Buffer): void; reject(error: Error): void }
    | undefined;
  #closedBy: Error | undefined;

  constructor(socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.#buffered = this.#buffered.length === 0 ? chunk : Buffer.concat([this.#buffered, chunk]);
      this.#deliver();
    });
    const close = (error?: Error) => {
      this.#closedBy = error ?? new Error('the connection to Xvnc closed');
      this.#waiting?.reject(this.#closedBy);
      this.#waiting = undefined;
    };
    socket.once('error', close);
    socket.once('close', () => close());
  }

  read(bytes: number): Promise<Buffer> {
    if (this.#waiting !== undefined) return Promise.reject(new Error('one read at a time'));
    if (this.#buffered.length >= bytes) return Promise.resolve(this.#take(bytes));
    if (this.#closedBy !== undefined) return Promise.reject(this.#closedBy);
    return new Promise((resolve, reject) => {
      this.#waiting = { bytes, resolve, reject };
    });
  }

  #deliver(): void {
    const waiting = this.#waiting;
    if (waiting === undefined || this.#buffered.length < waiting.bytes) return;
    this.#waiting = undefined;
    waiting.resolve(this.#take(waiting.bytes));
  }

  #take(bytes: number): Buffer {
    const data = this.#buffered.subarray(0, bytes);
    this.#buffered = this.#buffered.subarray(bytes);
    return data;
  }
}
