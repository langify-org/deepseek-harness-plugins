import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ViewerSession } from '../../../../src/client/viewer/viewer-session.ts';
import { FakeSocket } from '../fake-socket.ts';

function startSession() {
  const sockets: FakeSocket[] = [];
  const session = new ViewerSession({
    sessionId: 'session-1',
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const socket = () => {
    const last = sockets.at(-1);
    assert.ok(last !== undefined);
    return last;
  };
  return { session, sockets, socket };
}

test('gives its size and display first, then watches its session, opens the links that waited, and opens its window', () => {
  const { session, socket } = startSession();
  session.setArea(400, 600, 2);
  session.open('example.com');
  assert.deepEqual(socket().sent, []);
  socket().open();
  // The host knows the display when it first tells how Chrome draws for this tab.
  assert.deepEqual(socket().sent, [
    { type: 'viewport', width: 400, height: 600, devicePixelRatio: 2 },
    { type: 'watch', sessionId: 'session-1' },
    { type: 'open', url: 'example.com' },
    { type: 'open-window' },
  ]);
  assert.equal(session.getSnapshot().connection, 'connected');
});

test("sends its size and its display's pixel ratio when either changes, and only then", () => {
  const { session, socket } = startSession();
  socket().open();
  session.setArea(400, 600, 1);
  session.setArea(400, 600, 1);
  session.setArea(401, 600, 1);
  // Moved to a display of another density, at the same size.
  session.setArea(401, 600, 1.5);
  assert.deepEqual(
    socket().sent.filter((request) => request.type === 'viewport'),
    [
      { type: 'viewport', width: 400, height: 600, devicePixelRatio: 1 },
      { type: 'viewport', width: 401, height: 600, devicePixelRatio: 1 },
      { type: 'viewport', width: 401, height: 600, devicePixelRatio: 1.5 },
    ],
  );
});

test('claims the screen when the user works in it and another tab has it, once', () => {
  const { session, socket } = startSession();
  socket().open();
  socket().receive({ type: 'screen', owner: false, region: null });
  session.claimScreen();
  session.claimScreen();
  assert.deepEqual(socket().sent.filter((request) => request.type === 'claim-screen').length, 1);
  assert.equal(session.getSnapshot().screenOwner, true);
  // Another tab took it.
  socket().receive({ type: 'screen', owner: false, region: null });
  session.claimScreen();
  assert.deepEqual(socket().sent.filter((request) => request.type === 'claim-screen').length, 2);
});

test("keeps Chrome's state and the session's request for help as the host reports them", () => {
  const { session, socket } = startSession();
  socket().open();
  socket().receive({
    type: 'chrome',
    status: { kind: 'running', version: 'Chrome/154', restartFor: 'settings' },
  });
  const help = { id: 'help-1', message: 'Sign in', pageTitle: 'Bank', pageUrl: 'https://bank/' };
  socket().receive({ type: 'help', request: help });
  assert.deepEqual(session.getSnapshot().chrome, {
    kind: 'running',
    version: 'Chrome/154',
    restartFor: 'settings',
  });
  assert.deepEqual(session.getSnapshot().help, help);
  session.answerHelp('done');
  assert.deepEqual(socket().sent.at(-1), {
    type: 'answer-help',
    requestId: 'help-1',
    answer: 'done',
  });
  socket().receive({ type: 'help', request: null });
  assert.equal(session.getSnapshot().help, undefined);
});

test('reads the text of the page in front, or fails with the reason the host gives', async () => {
  const { session, socket } = startSession();
  socket().open();
  const reading = session.readText();
  const request = socket().sent.at(-1);
  assert.ok(request?.type === 'read-text');
  socket().receive({
    type: 'page-text',
    requestId: request.requestId,
    title: 'Doc',
    url: 'https://doc/',
    text: '# Doc',
  });
  assert.deepEqual(await reading, { title: 'Doc', url: 'https://doc/', text: '# Doc' });

  const failing = session.readText();
  const second = socket().sent.at(-1);
  assert.ok(second?.type === 'read-text');
  socket().receive({
    type: 'failed',
    requestType: 'read-text',
    requestId: second.requestId,
    message: 'Chrome shows no page',
  });
  await assert.rejects(failing, /Chrome shows no page/);
});

test('shows a failed request as a notice', () => {
  const { session, socket } = startSession();
  socket().open();
  socket().receive({
    type: 'failed',
    requestType: 'open',
    requestId: null,
    message: '"x" is not a web address',
  });
  assert.equal(session.getSnapshot().notice, '"x" is not a web address');
});

test('connects again after a drop, and tells the host its size again', async () => {
  const { session, sockets, socket } = startSession();
  socket().open();
  session.setArea(300, 500, 1);
  socket().receive({ type: 'screen', owner: true, region: null });
  socket().drop();
  assert.deepEqual(
    [session.getSnapshot().connection, session.getSnapshot().screenOwner],
    ['disconnected', false],
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(sockets.length, 2);
  socket().open();
  // A window the user closed meanwhile stays closed.
  assert.deepEqual(socket().sent, [
    { type: 'viewport', width: 300, height: 500, devicePixelRatio: 1 },
    { type: 'watch', sessionId: 'session-1' },
  ]);
  session.dispose();
});

test('asks for its window and opens waiting links only once the host knows its size and display', () => {
  const { session, socket } = startSession();
  socket().open();
  session.open('example.com');
  // Chrome would start before the host knew the display it draws for.
  assert.deepEqual(
    socket().sent.map((request) => request.type),
    ['watch'],
  );
  session.setArea(400, 600, 2);
  assert.deepEqual(socket().sent.slice(1), [
    { type: 'viewport', width: 400, height: 600, devicePixelRatio: 2 },
    { type: 'open', url: 'example.com' },
    { type: 'open-window' },
  ]);
});

test('asks for its window once, when it first connects, and not after a drop', async () => {
  const { session, sockets, socket } = startSession();
  session.setArea(400, 600, 1);
  socket().open();
  socket().drop();
  await new Promise((resolve) => setTimeout(resolve, 600));
  socket().open();
  assert.equal(sockets.length, 2);
  assert.equal(
    sockets.flatMap((one) => one.sent).filter((r) => r.type === 'open-window').length,
    1,
  );
  session.dispose();
});

test('asks for its window again, and for Chrome to start again, when told to', () => {
  const { session, socket } = startSession();
  session.setArea(400, 600, 1);
  socket().open();
  session.openWindow();
  session.restartChrome();
  assert.deepEqual(socket().sent.slice(-2), [{ type: 'open-window' }, { type: 'restart-chrome' }]);
});

test("follows the session's part of the screen and whether it has a window", () => {
  const { session, socket } = startSession();
  socket().open();
  assert.equal(session.getSnapshot().region, undefined);
  assert.equal(session.getSnapshot().windowsOpen, undefined);
  const region = { x: 0, y: 900, width: 1200, height: 800 };
  socket().receive({ type: 'screen', owner: true, region });
  socket().receive({ type: 'windows', open: true });
  assert.deepEqual(session.getSnapshot().region, region);
  assert.equal(session.getSnapshot().windowsOpen, true);
  socket().receive({ type: 'screen', owner: true, region: null });
  socket().receive({ type: 'windows', open: false });
  assert.equal(session.getSnapshot().region, undefined);
  assert.equal(session.getSnapshot().windowsOpen, false);
});
