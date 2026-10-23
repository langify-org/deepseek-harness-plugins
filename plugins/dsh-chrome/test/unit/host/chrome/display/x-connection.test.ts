import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { XConnection, XError } from '../../../../../src/host/chrome/display/x-connection.ts';

/**
 * A stand-in X server on a Unix socket, speaking just enough of the protocol for the host's
 * connection: the setup answer, and the answers the test scripts for each request.
 */
interface FakeServer {
  readonly path: string;
  /** What to do with each request after the setup, by opcode; it may answer or not. */
  onRequest: (opcode: number, sequence: number, socket: Socket) => void;
  close(): Promise<void>;
}

const ROOT_WINDOW = 0x123;
let dir = '';
let authorityPath = '';

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-x-'));
  authorityPath = join(dir, 'Xauthority');
  // One entry: family, address, display number, name, data, each counted.
  const counted = (data: Buffer) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(data.length);
    return Buffer.concat([length, data]);
  };
  await writeFile(
    authorityPath,
    Buffer.concat([
      Buffer.from([0xff, 0xff]),
      counted(Buffer.alloc(0)),
      counted(Buffer.alloc(0)),
      counted(Buffer.from('MIT-MAGIC-COOKIE-1')),
      counted(Buffer.alloc(16, 7)),
    ]),
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The setup answer of a server with one screen, whose root is ROOT_WINDOW. */
function setupAnswer(): Buffer {
  const vendor = Buffer.from('fake');
  // Fixed part (32 bytes after the 8-byte header), the vendor, no formats, one screen.
  const screen = Buffer.alloc(40);
  screen.writeUInt32LE(ROOT_WINDOW, 0);
  const body = Buffer.concat([Buffer.alloc(32), vendor, screen]);
  body.writeUInt16LE(vendor.length, 16);
  body[20] = 1; // screens
  body[21] = 0; // formats
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt16LE(11, 2);
  header.writeUInt16LE(body.length / 4, 6);
  return Buffer.concat([header, body]);
}

function reply(sequence: number, fill: (message: Buffer) => void = () => {}): Buffer {
  const message = Buffer.alloc(32);
  message[0] = 1;
  message.writeUInt16LE(sequence, 2);
  fill(message);
  return message;
}

function error(sequence: number, code: number): Buffer {
  const message = Buffer.alloc(32);
  message[0] = 0;
  message[1] = code;
  message.writeUInt16LE(sequence, 2);
  return message;
}

async function fakeServer(): Promise<FakeServer> {
  const path = join(dir, `X${Math.random().toString(36).slice(2)}`);
  const sockets = new Set<Socket>();
  const fake: FakeServer = {
    path,
    onRequest: () => {},
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    let buffered = Buffer.alloc(0);
    let setUp = false;
    let sequence = 0;
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!setUp) {
        if (buffered.length < 12) return;
        const pad = (n: number) => (4 - (n % 4)) % 4;
        const name = buffered.readUInt16LE(6);
        const data = buffered.readUInt16LE(8);
        const length = 12 + name + pad(name) + data + pad(data);
        if (buffered.length < length) return;
        buffered = buffered.subarray(length);
        setUp = true;
        socket.write(setupAnswer());
      }
      while (buffered.length >= 4) {
        const length = 4 * buffered.readUInt16LE(2);
        if (buffered.length < length) return;
        const opcode = buffered[0] as number;
        buffered = buffered.subarray(length);
        sequence = (sequence + 1) & 0xffff;
        fake.onRequest(opcode, sequence, socket);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return fake;
}

const GET_INPUT_FOCUS = 43;
const SET_INPUT_FOCUS = 42;

test('reads the window that has the keyboard focus, and none for PointerRoot', async () => {
  const server = await fakeServer();
  let focus = 0x400;
  server.onRequest = (opcode, sequence, socket) => {
    if (opcode === GET_INPUT_FOCUS) socket.write(reply(sequence, (m) => m.writeUInt32LE(focus, 8)));
  };
  const x = await XConnection.connect(':0', authorityPath, server.path);
  try {
    assert.equal(await x.inputFocus(), 0x400);
    focus = 1;
    assert.equal(await x.inputFocus(), undefined);
  } finally {
    x.close();
    await server.close();
  }
});

test("gives a window the focus, and rejects with the server's refusal of it", async () => {
  const server = await fakeServer();
  server.onRequest = (opcode, sequence, socket) => {
    // SetInputFocus has no answer but a refusal; GetInputFocus answers.
    if (opcode === SET_INPUT_FOCUS) socket.write(error(sequence, 3));
    if (opcode === GET_INPUT_FOCUS) socket.write(reply(sequence));
  };
  const x = await XConnection.connect(':0', authorityPath, server.path);
  try {
    await assert.rejects(
      x.focus(0x777),
      (thrown: unknown) => thrown instanceof XError && thrown.code === 3,
    );
    // The connection goes on answering.
    assert.equal(await x.inputFocus(), undefined);
  } finally {
    x.close();
    await server.close();
  }
});

test('a connection that closes while it gives the focus rejects once, with nothing left unhandled', async () => {
  const server = await fakeServer();
  // The server closes the connection on the first request: no answer to either.
  server.onRequest = (_opcode, _sequence, socket) => socket.destroy();
  const x = await XConnection.connect(':0', authorityPath, server.path);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await assert.rejects(x.focus(0x777), /closed/);
    // Give the event loop the turns an unhandled rejection is reported in.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(unhandled, []);
    assert.equal(x.closed, true);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await server.close();
  }
});

test('says when the connection closes, to whoever listens, and at once to a later listener', async () => {
  const server = await fakeServer();
  const x = await XConnection.connect(':0', authorityPath, server.path);
  const heard: string[] = [];
  x.onClose((error) => heard.push(error.message));
  await server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(heard.length, 1);
  x.onClose(() => heard.push('later'));
  assert.equal(heard.at(-1), 'later');
});

test('a server that does not answer the connection fails it in time', async () => {
  const path = join(dir, 'silent');
  const sockets = new Set<Socket>();
  const silent = createServer((socket) => {
    sockets.add(socket);
    // Says nothing, then closes.
    setTimeout(() => socket.destroy(), 100);
  });
  await new Promise<void>((resolve) => silent.listen(path, resolve));
  try {
    await assert.rejects(XConnection.connect(':0', authorityPath, path), /closed the connection/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  }
});
