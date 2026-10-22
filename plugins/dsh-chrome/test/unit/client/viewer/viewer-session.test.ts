import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import { ViewerSession } from '../../../../src/client/viewer/viewer-session.ts';
import type { ViewerEvent, ViewerRequest } from '../../../../src/protocol/viewer.ts';

/** The events a DSH socket delivers (`ConnectionWebSocketEventMap`, which DSH does not export). */
interface SocketEvents {
  readonly open: object;
  readonly error: object;
  readonly close: object;
  readonly message: { readonly data: unknown };
}
type EventName = keyof SocketEvents;

/** The host's end of a viewer socket, as the tab sees it. */
class FakeSocket implements ConnectionWebSocket {
  readyState = 0;
  readonly sent: ViewerRequest[] = [];
  readonly #listeners = new Map<EventName, Set<(event: never) => void>>();

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ViewerRequest);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener<E extends EventName>(
    event: E,
    listener: (event: SocketEvents[E]) => void,
  ): void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.#listeners.set(event, listeners);
  }

  removeEventListener<E extends EventName>(
    event: E,
    listener: (event: SocketEvents[E]) => void,
  ): void {
    this.#listeners.get(event)?.delete(listener as (event: never) => void);
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  drop(): void {
    this.readyState = 3;
    this.#emit('close', {});
  }

  receive(event: ViewerEvent): void {
    this.#emit('message', { data: JSON.stringify(event) });
  }

  #emit<E extends EventName>(event: E, payload: SocketEvents[E]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      (listener as (payload: SocketEvents[E]) => void)(payload);
    }
  }
}

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

test('watches its session first, then gives its size, opens the links that waited, and starts Chrome', () => {
  const { session, socket } = startSession();
  session.setArea(400, 600);
  session.open('example.com');
  assert.deepEqual(socket().sent, []);
  socket().open();
  assert.deepEqual(socket().sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'viewport', width: 400, height: 600 },
    { type: 'open', url: 'example.com' },
    { type: 'start-chrome' },
  ]);
  assert.equal(session.getSnapshot().connection, 'connected');
});

test('sends its size when it changes, and only then', () => {
  const { session, socket } = startSession();
  socket().open();
  session.setArea(400, 600);
  session.setArea(400, 600);
  session.setArea(401, 600);
  assert.deepEqual(
    socket().sent.filter((request) => request.type === 'viewport'),
    [
      { type: 'viewport', width: 400, height: 600 },
      { type: 'viewport', width: 401, height: 600 },
    ],
  );
});

test('claims the screen when the user works in it and another tab has it, once', () => {
  const { session, socket } = startSession();
  socket().open();
  socket().receive({ type: 'screen', owner: false });
  session.claimScreen();
  session.claimScreen();
  assert.deepEqual(socket().sent.filter((request) => request.type === 'claim-screen').length, 1);
  assert.equal(session.getSnapshot().screenOwner, true);
  // Another tab took it.
  socket().receive({ type: 'screen', owner: false });
  session.claimScreen();
  assert.deepEqual(socket().sent.filter((request) => request.type === 'claim-screen').length, 2);
});

test("keeps Chrome's state and the session's request for help as the host reports them", () => {
  const { session, socket } = startSession();
  socket().open();
  socket().receive({ type: 'chrome', status: { kind: 'running', version: 'Chrome/154' } });
  const help = { id: 'help-1', message: 'Sign in', pageTitle: 'Bank', pageUrl: 'https://bank/' };
  socket().receive({ type: 'help', request: help });
  assert.deepEqual(session.getSnapshot().chrome, { kind: 'running', version: 'Chrome/154' });
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
  session.setArea(300, 500);
  socket().receive({ type: 'screen', owner: true });
  socket().drop();
  assert.deepEqual(
    [session.getSnapshot().connection, session.getSnapshot().screenOwner],
    ['disconnected', false],
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(sockets.length, 2);
  socket().open();
  // A Chrome the user closed meanwhile stays closed.
  assert.deepEqual(socket().sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'viewport', width: 300, height: 500 },
  ]);
  session.dispose();
});
