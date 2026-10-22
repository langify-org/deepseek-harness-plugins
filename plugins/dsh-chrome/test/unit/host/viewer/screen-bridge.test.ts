import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
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
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { path, connections, closed };
}

/** A DSH Host's web server, as far as the screen route goes. */
async function screenRoute(vncSocketPath: Promise<string>): Promise<string> {
  const sockets = new WebSocketServer({ noServer: true });
  const http = createHttpServer();
  http.on('upgrade', (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (webSocket) =>
      bridgeScreen(webSocket, vncSocketPath, silentLog),
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
  client.socket.send(Buffer.from([1, 2, 3, 250]));
  await until(() => Buffer.concat(client.received).length === 16);
  assert.deepEqual([...Buffer.concat(client.received).subarray(12)], [1, 2, 3, 250]);

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
