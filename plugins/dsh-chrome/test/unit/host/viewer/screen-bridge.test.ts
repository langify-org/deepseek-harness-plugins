import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import type { KeyboardFocus } from '../../../../src/host/chrome/chrome-service.ts';
import { silentLog } from '../../../../src/host/platform/log.ts';
import { bridgeScreen } from '../../../../src/host/viewer/screen-bridge.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-bridge-'));
after(() => rm(scratch, { recursive: true, force: true }));

/** A stand-in for the screen's VNC socket: it greets as a VNC server does, then echoes. */
async function vncServer(name: string) {
  const path = join(scratch, `${name}.sock`);
  const connections: Socket[] = [];
  const closed: Promise<void>[] = [];
  const server = createServer((socket) => {
    connections.push(socket);
    closed.push(new Promise((resolve) => socket.once('close', () => resolve())));
    socket.write('RFB 003.008\n');
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  after(() => {
    for (const connection of connections) connection.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { path, connections, closed };
}

/** A keyboard that gives the focus at once. */
const freeKeyboard = {
  deliver: (_sessionId: string, write: () => void) => {
    write();
    return Promise.resolve();
  },
} as unknown as KeyboardFocus;

/** What a viewer sends first: the version, the security type None, and ClientInit. */
const HANDSHAKE = Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1])]);
/** A KeyEvent (type 4) pressing the key with this keysym. */
const keyEvent = (keysym: number) => Buffer.from([4, 1, 0, 0, 0, 0, 0, keysym]);
/** A FramebufferUpdateRequest (type 3). */
const updateRequest = Buffer.from([3, 1, 0, 0, 0, 0, 0, 10, 0, 10]);
/** A SetDesktopSize (type 251) with no screens. */
const setDesktopSize = Buffer.from([251, 0, 7, 128, 4, 176, 0, 0]);

/** A DSH Host's web server, as far as the screen route goes. */
async function screenRoute(
  vncSocketPath: Promise<string>,
  keyboard: KeyboardFocus = freeKeyboard,
): Promise<string> {
  const sockets = new WebSocketServer({ noServer: true });
  const http = createHttpServer();
  http.on('upgrade', (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (webSocket) =>
      bridgeScreen(webSocket, { sessionId: 'session-1', vncSocketPath, keyboard, log: silentLog }),
    );
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  after(() => {
    for (const client of sockets.clients) client.terminate();
    return new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return `ws://127.0.0.1:${(http.address() as AddressInfo).port}/`;
}

/** The viewer's end: what it receives, in order, and how it was closed. */
function viewer(url: string) {
  const socket = new WebSocket(url);
  // A failed test must not leave the viewer open, which would hold the run.
  after(() => socket.terminate());
  const received: Buffer[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  socket.on('message', (data, isBinary) => {
    if (isBinary) received.push(data as Buffer);
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, received, closed, opened };
}

async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(condition(), 'timed out');
}

test("carries the screen's bytes to the viewer and the viewer's back, unchanged", async () => {
  const vnc = await vncServer('echo');
  const client = viewer(await screenRoute(Promise.resolve(vnc.path)));
  await client.opened;
  await until(() => Buffer.concat(client.received).toString() === 'RFB 003.008\n');
  client.socket.send(Buffer.concat([HANDSHAKE, updateRequest]));
  await until(() => Buffer.concat(client.received).length === 12 + 14 + 10);
  assert.deepEqual(
    Buffer.concat(client.received).subarray(12),
    Buffer.concat([HANDSHAKE, updateRequest]),
  );

  // A viewer that leaves takes its VNC connection with it.
  client.socket.close();
  await vnc.closed[0];
});

test('closes a viewer that sends text, which VNC does not carry', async () => {
  const vnc = await vncServer('text');
  const client = viewer(await screenRoute(Promise.resolve(vnc.path)));
  await client.opened;
  client.socket.send('hello');
  assert.equal((await client.closed).code, 1003);
});

test('tells the viewer why, when the screen could not start', async () => {
  const failed = Promise.reject(new Error('Xvnc was not found'));
  failed.catch(() => {});
  const client = viewer(await screenRoute(failed));
  const { code, reason } = await client.closed;
  assert.equal(code, 1011);
  assert.equal(reason, 'the screen did not start: Xvnc was not found');
});

test('closes the viewer when the screen closes its end', async () => {
  const vnc = await vncServer('hangup');
  const client = viewer(await screenRoute(Promise.resolve(vnc.path)));
  await client.opened;
  await until(() => vnc.connections.length === 1);
  vnc.connections[0]?.destroy();
  await client.closed;
});

/** The sessions and writes a keyboard was asked for, answering when the test says. */
function heldKeyboard() {
  const asked: { sessionId: string; write: () => void; release: () => void }[] = [];
  const keyboard = {
    deliver: (sessionId: string, write: () => void) =>
      new Promise<void>((resolve) => {
        asked.push({ sessionId, write, release: resolve });
      }),
  } as unknown as KeyboardFocus;
  return { keyboard, asked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('writes a key only when the keyboard gives it its turn, and keeps the messages after it behind it', async () => {
  const vnc = await vncServer('keys');
  const { keyboard, asked } = heldKeyboard();
  const client = viewer(await screenRoute(Promise.resolve(vnc.path), keyboard));
  await client.opened;
  const echoed = () => Buffer.concat(client.received).subarray(12);
  client.socket.send(HANDSHAKE);
  await until(() => echoed().length === HANDSHAKE.length);

  client.socket.send(Buffer.concat([keyEvent(65), updateRequest, keyEvent(66)]));
  await until(() => asked.length === 1);
  await settle();
  assert.equal(asked[0]?.sessionId, 'session-1');
  // Neither the key nor the request behind it has gone.
  assert.equal(echoed().length, HANDSHAKE.length);

  asked[0]?.write();
  asked[0]?.release();
  await until(() => echoed().length === HANDSHAKE.length + 8 + 10);
  assert.deepEqual(
    echoed().subarray(HANDSHAKE.length),
    Buffer.concat([keyEvent(65), updateRequest]),
  );

  // The second key waits for its own turn.
  await until(() => asked.length === 2);
  assert.equal(echoed().length, HANDSHAKE.length + 18);
  asked[1]?.write();
  asked[1]?.release();
  await until(() => echoed().length === HANDSHAKE.length + 26);
  assert.deepEqual(echoed().subarray(-8), keyEvent(66));
});

test('writes a QEMU extended key event only through the keyboard too', async () => {
  const vnc = await vncServer('qemu-keys');
  const { keyboard, asked } = heldKeyboard();
  const client = viewer(await screenRoute(Promise.resolve(vnc.path), keyboard));
  await client.opened;
  client.socket.send(
    Buffer.concat([HANDSHAKE, Buffer.from([255, 0, 0, 1, 0, 0, 0, 65, 0, 0, 0, 30])]),
  );
  await until(() => asked.length === 1);
  await settle();
  assert.equal(Buffer.concat(client.received).length, 12 + HANDSHAKE.length);
  asked[0]?.write();
  asked[0]?.release();
  await until(() => Buffer.concat(client.received).length === 12 + HANDSHAKE.length + 12);
});

test("does not write the viewer's change of the screen's size to the screen", async () => {
  const vnc = await vncServer('desktop-size');
  const client = viewer(await screenRoute(Promise.resolve(vnc.path)));
  await client.opened;
  client.socket.send(Buffer.concat([HANDSHAKE, setDesktopSize, updateRequest]));
  await until(() => Buffer.concat(client.received).length === 12 + HANDSHAKE.length + 10);
  assert.deepEqual(
    Buffer.concat(client.received).subarray(12),
    Buffer.concat([HANDSHAKE, updateRequest]),
  );
});

test('closes a viewer whose first message is not a VNC version, as a protocol error', async () => {
  const vnc = await vncServer('not-rfb');
  const client = viewer(await screenRoute(Promise.resolve(vnc.path)));
  await client.opened;
  client.socket.send(Buffer.from('GET / HTTP/1.1\r\n'));
  assert.equal((await client.closed).code, 1002);
});
