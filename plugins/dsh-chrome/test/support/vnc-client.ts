import { createConnection, type Socket } from 'node:net';

/**
 * A VNC client for the tests, as a viewer is to the screen: it reads the screen's pixels and
 * size, and sends pointer, key and clipboard events. It asks for raw pixels only, which a
 * test can read without decoding.
 */
export class VncClient {
  readonly #socket: Socket;
  #buffered = Buffer.alloc(0);
  #waiting: (() => void) | undefined;
  #closed = false;
  width = 0;
  height = 0;
  /** The screen's pixels as the client last read them: 4 bytes each, blue, green, red, unused. */
  pixels = Buffer.alloc(0);
  /** Text the screen put on its clipboard. */
  readonly clipboard: string[] = [];
  /** How many updates carried pixels. */
  #pixelUpdates = 0;
  /** Whether {@link refresh} waits for pixels. */
  #wantsPixels = false;

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.#buffered = Buffer.concat([this.#buffered, chunk]);
      this.#waiting?.();
    });
    socket.on('close', () => {
      this.#closed = true;
      this.#waiting?.();
    });
    socket.on('error', () => {});
  }

  static async connect(socketPath: string): Promise<VncClient> {
    const socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('error', reject);
    });
    const client = new VncClient(socket);
    await client.#handshake();
    void client.#readMessages().catch(() => {});
    return client;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Reads the whole screen anew; resolves once it has. Xvnc answers a request for the whole
   * screen with its layout first, and the pixels to the next request.
   */
  async refresh(): Promise<void> {
    const before = this.#pixelUpdates;
    this.#wantsPixels = true;
    this.#requestUpdate(false);
    for (let attempt = 0; attempt < 500 && this.#pixelUpdates === before; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.#pixelUpdates === before) throw new Error('the screen sent no pixels');
  }

  /** The colour at a point of the screen, as [red, green, blue]. */
  colourAt(x: number, y: number): [number, number, number] {
    const offset = (Math.round(y) * this.width + Math.round(x)) * 4;
    return [this.pixels[offset + 2] ?? 0, this.pixels[offset + 1] ?? 0, this.pixels[offset] ?? 0];
  }

  /** Moves the pointer, with the buttons held: 1 is the left one. */
  pointer(x: number, y: number, buttons: number): void {
    const message = Buffer.alloc(6);
    message[0] = 5;
    message[1] = buttons;
    message.writeUInt16BE(Math.round(x), 2);
    message.writeUInt16BE(Math.round(y), 4);
    this.#socket.write(message);
  }

  click(x: number, y: number): void {
    this.pointer(x, y, 0);
    this.pointer(x, y, 1);
    this.pointer(x, y, 0);
  }

  key(keysym: number, down: boolean): void {
    const message = Buffer.alloc(8);
    message[0] = 4;
    message[1] = down ? 1 : 0;
    message.writeUInt32BE(keysym >>> 0, 4);
    this.#socket.write(message);
  }

  /** Presses the keys in order and releases them in reverse, as a shortcut is typed. */
  press(...keysyms: number[]): void {
    for (const keysym of keysyms) this.key(keysym, true);
    for (const keysym of [...keysyms].reverse()) this.key(keysym, false);
  }

  /** Offers text as the screen's clipboard. */
  paste(text: string): void {
    const bytes = Buffer.from(text, 'latin1');
    const message = Buffer.alloc(8 + bytes.length);
    message[0] = 6;
    message.writeUInt32BE(bytes.length, 4);
    bytes.copy(message, 8);
    this.#socket.write(message);
  }

  close(): void {
    this.#socket.destroy();
  }

  async #read(bytes: number): Promise<Buffer> {
    while (this.#buffered.length < bytes) {
      if (this.#closed) throw new Error('the screen closed the connection');
      await new Promise<void>((resolve) => {
        this.#waiting = resolve;
      });
    }
    const data = this.#buffered.subarray(0, bytes);
    this.#buffered = this.#buffered.subarray(bytes);
    return data;
  }

  async #handshake(): Promise<void> {
    await this.#read(12);
    this.#socket.write('RFB 003.008\n');
    const count = (await this.#read(1))[0] ?? 0;
    await this.#read(count);
    this.#socket.write(Buffer.from([1]));
    await this.#read(4);
    this.#socket.write(Buffer.from([1]));
    const init = await this.#read(24);
    this.#resize(init.readUInt16BE(0), init.readUInt16BE(2));
    await this.#read(init.readUInt32BE(20));
    // Raw pixels, and the desktop's size as it changes.
    const encodings = [0, -223, -308];
    const message = Buffer.alloc(4 + 4 * encodings.length);
    message[0] = 2;
    message.writeUInt16BE(encodings.length, 2);
    for (const [index, encoding] of encodings.entries()) {
      message.writeInt32BE(encoding, 4 + 4 * index);
    }
    this.#socket.write(message);
  }

  #requestUpdate(incremental: boolean): void {
    const message = Buffer.alloc(10);
    message[0] = 3;
    message[1] = incremental ? 1 : 0;
    message.writeUInt16BE(this.width, 6);
    message.writeUInt16BE(this.height, 8);
    this.#socket.write(message);
  }

  #resize(width: number, height: number): void {
    // The server reports the size in updates that also carry pixels, changed or not.
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
  }

  async #readMessages(): Promise<void> {
    for (;;) {
      const type = (await this.#read(1))[0];
      if (type === 0) {
        let pixels = false;
        const rectangles = (await this.#read(3)).readUInt16BE(1);
        for (let index = 0; index < rectangles; index += 1) {
          const header = await this.#read(12);
          const x = header.readUInt16BE(0);
          const y = header.readUInt16BE(2);
          const width = header.readUInt16BE(4);
          const height = header.readUInt16BE(6);
          const encoding = header.readInt32BE(8);
          if (encoding === 0) {
            pixels = true;
            const data = await this.#read(width * height * 4);
            for (let row = 0; row < height; row += 1) {
              data.copy(
                this.pixels,
                ((y + row) * this.width + x) * 4,
                row * width * 4,
                (row + 1) * width * 4,
              );
            }
          } else if (encoding === -308) {
            const screens = (await this.#read(4))[0] ?? 0;
            await this.#read(16 * screens);
            this.#resize(width, height);
          } else if (encoding === -223) {
            this.#resize(width, height);
          } else {
            throw new Error(`unexpected encoding ${encoding}`);
          }
        }
        if (pixels) {
          this.#pixelUpdates += 1;
          this.#wantsPixels = false;
        } else if (this.#wantsPixels) {
          this.#requestUpdate(true);
        }
      } else if (type === 1) {
        const header = await this.#read(5);
        await this.#read(header.readUInt16BE(3) * 6);
      } else if (type === 2) {
        // A bell.
      } else if (type === 3) {
        const header = await this.#read(7);
        this.clipboard.push((await this.#read(header.readUInt32BE(3))).toString('latin1'));
      } else {
        throw new Error(`unexpected message ${type}`);
      }
    }
  }
}
