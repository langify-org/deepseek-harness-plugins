import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ScreenControl } from '../../../../../src/host/chrome/display/screen-control.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-rfb-'));
after(() => rm(scratch, { recursive: true, force: true }));

interface FakeVncOptions {
  readonly width: number;
  readonly height: number;
  /** The security types it offers; 1 is None. */
  readonly securityTypes?: readonly number[];
  /** The status it answers a change of size with; 0 takes it. */
  readonly resizeStatus?: number;
}

/**
 * A VNC server as Xvnc is to the screen's control connection: it greets, takes the size
 * the client sets, and answers update requests with the layout when it changed and a pixel.
 */
class FakeVncServer {
  readonly server: Server;
  readonly path: string;
  width: number;
  height: number;
  /** The sizes clients asked for. */
  readonly asked: { width: number; height: number }[] = [];
  /** The clients' connections. */
  readonly sockets: Socket[] = [];

  constructor(path: string, options: FakeVncOptions) {
    this.path = path;
    this.width = options.width;
    this.height = options.height;
    // A client that hangs up ends the conversation, wherever it was.
    this.server = createServer((socket) => void this.#serve(socket, options).catch(() => {}));
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.path, resolve));
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  async #serve(socket: Socket, options: FakeVncOptions): Promise<void> {
    this.sockets.push(socket);
    socket.on('error', () => {});
    const read = reader(socket);
    socket.write('RFB 003.008\n');
    await read(12);
    const types = options.securityTypes ?? [1];
    socket.write(Buffer.from([types.length, ...types]));
    await read(1);
    socket.write(Buffer.from([0, 0, 0, 0]));
    await read(1);
    const name = Buffer.from('fake');
    const init = Buffer.alloc(24);
    init.writeUInt16BE(this.width, 0);
    init.writeUInt16BE(this.height, 2);
    init[4] = 32;
    init.writeUInt32BE(name.length, 20);
    socket.write(Buffer.concat([init, name]));
    /** The layout change the next update carries: why, and the result. */
    let layout: { reason: number; status: number } | undefined;
    for (;;) {
      const type = (await read(1).catch(() => undefined))?.[0];
      if (type === undefined) return;
      if (type === 2) {
        const count = (await read(3)).readUInt16BE(1);
        const encodings = await read(4 * count);
        const wanted = Array.from({ length: count }, (_, index) =>
          encodings.readInt32BE(4 * index),
        );
        if (wanted.includes(-308)) layout = { reason: 0, status: 0 };
      } else if (type === 3) {
        await read(9);
        socket.write(this.#update(layout));
        layout = undefined;
      } else if (type === 251) {
        const header = await read(7);
        const width = header.readUInt16BE(1);
        const height = header.readUInt16BE(3);
        await read(16 * (header[5] ?? 0));
        this.asked.push({ width, height });
        const status = options.resizeStatus ?? 0;
        if (status === 0) {
          this.width = width;
          this.height = height;
        }
        layout = { reason: 1, status };
      } else {
        throw new Error(`unexpected client message ${type}`);
      }
    }
  }

  #update(layout: { reason: number; status: number } | undefined): Buffer {
    const rectangles: Buffer[] = [];
    if (layout !== undefined) {
      const header = rectangle(layout.reason, layout.status, this.width, this.height, -308);
      const screens = Buffer.alloc(4 + 16);
      screens[0] = 1;
      screens.writeUInt32BE(77, 4);
      screens.writeUInt16BE(this.width, 12);
      screens.writeUInt16BE(this.height, 14);
      rectangles.push(header, screens);
    }
    rectangles.push(rectangle(0, 0, 1, 1, 0), Buffer.alloc(4));
    const head = Buffer.alloc(4);
    head.writeUInt16BE(layout === undefined ? 1 : 2, 2);
    return Buffer.concat([head, ...rectangles]);
  }
}

function rectangle(x: number, y: number, width: number, height: number, encoding: number): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(x, 0);
  header.writeUInt16BE(y, 2);
  header.writeUInt16BE(width, 4);
  header.writeUInt16BE(height, 6);
  header.writeInt32BE(encoding, 8);
  return header;
}

function reader(socket: Socket): (bytes: number) => Promise<Buffer> {
  let buffered = Buffer.alloc(0);
  let waiting: (() => void) | undefined;
  let closed = false;
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    waiting?.();
  });
  socket.on('close', () => {
    closed = true;
    waiting?.();
  });
  return async (bytes) => {
    while (buffered.length < bytes) {
      if (closed) throw new Error('closed');
      await new Promise<void>((resolve) => {
        waiting = resolve;
      });
    }
    const data = buffered.subarray(0, bytes);
    buffered = buffered.subarray(bytes);
    return data;
  };
}

async function serving(name: string, options: FakeVncOptions): Promise<FakeVncServer> {
  const server = new FakeVncServer(join(scratch, `${name}.sock`), options);
  await server.listen();
  after(() => server.close());
  return server;
}

/** A layout of the control's one monitor, at the size: the monitor keeps the id Xvnc gave it. */
const oneMonitor = (control: ScreenControl, width: number, height: number) => ({
  width,
  height,
  monitors: [{ id: control.layout.monitors[0]?.id ?? 0, x: 0, y: 0, width, height }],
});

/** The screen's size, as the control last heard it. */
const sizeOf = (control: ScreenControl) => ({
  width: control.layout.width,
  height: control.layout.height,
});

test("learns the screen's size, and lays it out as asked", async () => {
  const server = await serving('resize', { width: 1280, height: 800 });
  const control = await ScreenControl.connect(server.path);
  assert.deepEqual(sizeOf(control), { width: 1280, height: 800 });
  await control.setLayout(oneMonitor(control, 1200, 1800));
  assert.deepEqual(sizeOf(control), { width: 1200, height: 1800 });
  assert.deepEqual([server.width, server.height], [1200, 1800]);
  // The layout it has is not asked for again.
  await control.setLayout(oneMonitor(control, 1200, 1800));
  assert.equal(server.asked.length, 1);
  control.close();
});

test('says why the screen kept its size, when the server refuses the change', async () => {
  const server = await serving('refuse', { width: 1280, height: 800, resizeStatus: 3 });
  const control = await ScreenControl.connect(server.path);
  await assert.rejects(
    control.setLayout(oneMonitor(control, 10, 10)),
    /the screen layout is invalid/,
  );
  assert.deepEqual(sizeOf(control), { width: 1280, height: 800 });
  control.close();
});

test('refuses a server that asks for a password', async () => {
  const server = await serving('password', { width: 640, height: 480, securityTypes: [2] });
  await assert.rejects(ScreenControl.connect(server.path), /asks for authentication/);
});

test('fails a change of size at once when Xvnc closes the connection', async () => {
  const server = await serving('hangup', { width: 640, height: 480 });
  const control = await ScreenControl.connect(server.path);
  // Xvnc goes away without answering.
  server.server.close();
  for (const socket of server.sockets) socket.destroy();
  const started = Date.now();
  // With the reason the connection ended: closed, or a write that failed.
  await assert.rejects(control.setLayout(oneMonitor(control, 300, 300)));
  assert.ok(Date.now() - started < 1000, 'it waited for its timeout');
});
