import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import { ViewerSession } from '../../../src/client/viewer/viewer-session.ts';
import {
  encodeFrame,
  type FrameHeader,
  type PageState,
  type ViewerEvent,
  type ViewerRequest,
} from '../../../src/protocol/viewer.ts';

const DEFAULT_VIEWPORT = { width: 800, height: 600, deviceScaleFactor: 1 };

interface SocketEventMap {
  readonly open: object;
  readonly error: object;
  readonly close: object;
  readonly message: { readonly data: unknown };
}

type SocketEventName = keyof SocketEventMap;

/** A socket the test drives: it records requests and fires the events a host would. */
class FakeSocket implements ConnectionWebSocket {
  readyState = 0;
  readonly sent: ViewerRequest[] = [];
  readonly #listeners = new Map<SocketEventName, Set<unknown>>();

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ViewerRequest);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener<Event extends SocketEventName>(
    event: Event,
    listener: (event: SocketEventMap[Event]) => void,
  ): void {
    let listeners = this.#listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener<Event extends SocketEventName>(
    event: Event,
    listener: (event: SocketEventMap[Event]) => void,
  ): void {
    this.#listeners.get(event)?.delete(listener);
  }

  fireOpen(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  fireClose(): void {
    this.readyState = 3;
    this.#emit('close', {});
  }

  fireEvent(event: ViewerEvent): void {
    this.#emit('message', { data: JSON.stringify(event) });
  }

  fireFrame(header: FrameHeader, image: Uint8Array<ArrayBuffer>): void {
    this.#emit('message', { data: encodeFrame(header, image).buffer });
  }

  #emit<Event extends SocketEventName>(event: Event, payload: SocketEventMap[Event]): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (payload: SocketEventMap[Event]) => void)(payload);
    }
  }
}

interface FakeViewer {
  readonly sockets: FakeSocket[];
  readonly remembered: (string | undefined)[];
  readonly session: ViewerSession;
}

function startViewer(rememberedPageId: string | undefined): FakeViewer {
  const sockets: FakeSocket[] = [];
  const remembered: (string | undefined)[] = [];
  const session = new ViewerSession({
    sessionId: 'session-1',
    openSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    rememberedPageId,
    rememberPage: (pageId) => remembered.push(pageId),
  });
  return { sockets, remembered, session };
}

function lastSocket(viewer: FakeViewer): FakeSocket {
  const socket = viewer.sockets.at(-1);
  assert.ok(socket !== undefined);
  return socket;
}

function page(id: string, openedBy: PageState['openedBy'] = 'agent'): PageState {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    loading: false,
    browserLabel: 'Chrome',
    openedBy,
  };
}

const pageA = page('page-a');
const pageB = page('page-b');
const pageC = page('page-c');

function attachCount(socket: FakeSocket): number {
  return socket.sent.filter((request) => request.type === 'attach').length;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('does not switch to a page the user opened elsewhere', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA] });
  socket.fireEvent({ type: 'attached', page: pageA });
  const attachesBefore = attachCount(socket);

  const fromAnotherTab = page('page-d', 'user');
  socket.fireEvent({ type: 'pages', pages: [fromAnotherTab, pageA] });
  assert.equal(attachCount(socket), attachesBefore);
  assert.deepEqual(viewer.session.getSnapshot().page, pageA);
});

test('sends watch first and then attaches the remembered page when the socket opens', () => {
  const viewer = startViewer('page-a');
  assert.equal(viewer.session.getSnapshot().status, 'connecting');
  const socket = lastSocket(viewer);
  assert.deepEqual(socket.sent, []);

  socket.fireOpen();

  assert.equal(viewer.session.getSnapshot().status, 'connected');
  assert.deepEqual(socket.sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'attach', pageId: 'page-a', viewport: DEFAULT_VIEWPORT },
  ]);
});

test('sends only watch when the tab has no remembered page', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);

  socket.fireOpen();

  assert.deepEqual(socket.sent, [{ type: 'watch', sessionId: 'session-1' }]);
  assert.equal(viewer.session.getSnapshot().page, undefined);
});

test('attaches the most recent page when the first page list arrives with no page shown', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();

  socket.fireEvent({ type: 'pages', pages: [pageA, pageB] });

  assert.deepEqual(viewer.session.getSnapshot().pages, [pageA, pageB]);
  assert.deepEqual(socket.sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'attach', pageId: 'page-a', viewport: DEFAULT_VIEWPORT },
  ]);
});

test('records the attached page, clears the notice, and remembers its id', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  viewer.session.notify('Waiting for the page.');
  assert.equal(viewer.session.getSnapshot().notice, 'Waiting for the page.');

  socket.fireEvent({ type: 'attached', page: pageA });

  assert.deepEqual(viewer.session.getSnapshot().page, pageA);
  assert.equal(viewer.session.getSnapshot().notice, undefined);
  assert.deepEqual(viewer.remembered, ['page-a']);
});

test('attaches a page that newly appears in the list but not a page that only moved', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA] });
  socket.fireEvent({ type: 'attached', page: pageA });

  socket.fireEvent({ type: 'pages', pages: [pageB, pageA] });

  assert.deepEqual(socket.sent.at(-1), {
    type: 'attach',
    pageId: 'page-b',
    viewport: DEFAULT_VIEWPORT,
  });
  socket.fireEvent({ type: 'attached', page: pageB });

  const sentBefore = socket.sent.length;
  socket.fireEvent({ type: 'pages', pages: [pageA, pageB] });
  assert.equal(socket.sent.length, sentBefore);
  assert.deepEqual(viewer.session.getSnapshot().pages, [pageA, pageB]);
  assert.deepEqual(viewer.session.getSnapshot().page, pageB);
});

test('ending a page clears it, sets the closed notice, and attaches the next page', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA, pageB] });
  socket.fireEvent({ type: 'attached', page: pageA });
  socket.fireEvent({ type: 'help', request: { id: 'help-1', message: 'Sign in.' } });

  socket.fireEvent({ type: 'ended', reason: 'closed' });

  const snapshot = viewer.session.getSnapshot();
  assert.equal(snapshot.page, undefined);
  assert.equal(snapshot.help, undefined);
  assert.equal(snapshot.notice, 'The page was closed.');
  assert.deepEqual(snapshot.pages, [pageA, pageB]);
  assert.deepEqual(viewer.remembered, ['page-a', undefined]);
  assert.deepEqual(socket.sent.at(-1), {
    type: 'attach',
    pageId: 'page-b',
    viewport: DEFAULT_VIEWPORT,
  });
});

test('does not re-attach a page that ended while it remains first in the last list', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA, pageB] });
  socket.fireEvent({ type: 'attached', page: pageA });

  socket.fireEvent({ type: 'ended', reason: 'closed' });
  assert.deepEqual(socket.sent.at(-1), {
    type: 'attach',
    pageId: 'page-b',
    viewport: DEFAULT_VIEWPORT,
  });
  socket.fireEvent({ type: 'attached', page: pageB });

  const sentBefore = socket.sent.length;
  socket.fireEvent({ type: 'ended', reason: 'closed' });
  assert.equal(socket.sent.length, sentBefore);
  assert.equal(viewer.session.getSnapshot().page, undefined);
  assert.deepEqual(viewer.session.getSnapshot().pages, [pageA, pageB]);

  socket.fireEvent({ type: 'pages', pages: [pageA, pageB] });
  assert.deepEqual(socket.sent.at(-1), {
    type: 'attach',
    pageId: 'page-a',
    viewport: DEFAULT_VIEWPORT,
  });
});

test('opens a url with the current viewport and sends no attach while the open is pending', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA] });
  socket.fireEvent({ type: 'attached', page: pageA });

  viewer.session.open('https://example.com/new');
  assert.deepEqual(socket.sent.at(-1), {
    type: 'open',
    url: 'https://example.com/new',
    viewport: DEFAULT_VIEWPORT,
  });

  const attachesBefore = attachCount(socket);
  socket.fireEvent({ type: 'pages', pages: [pageC, pageA] });
  assert.equal(attachCount(socket), attachesBefore);
  assert.deepEqual(viewer.session.getSnapshot().pages, [pageC, pageA]);

  socket.fireEvent({ type: 'attached', page: pageC });
  assert.deepEqual(viewer.session.getSnapshot().page, pageC);
});

test('resizes only once a page is shown and keeps the viewport for opening a page', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  const tall = { width: 1024, height: 768, deviceScaleFactor: 2 };

  viewer.session.resize(tall);
  assert.deepEqual(socket.sent, [{ type: 'watch', sessionId: 'session-1' }]);

  viewer.session.open('https://example.com/');
  assert.deepEqual(socket.sent.at(-1), {
    type: 'open',
    url: 'https://example.com/',
    viewport: tall,
  });

  socket.fireEvent({ type: 'attached', page: pageA });
  const wide = { width: 1280, height: 720, deviceScaleFactor: 1 };
  viewer.session.resize(wide);
  assert.deepEqual(socket.sent.at(-1), { type: 'resize', viewport: wide });
});

test('sends visibility false once and again after reconnecting', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = startViewer(undefined);
  const first = lastSocket(viewer);
  first.fireOpen();

  viewer.session.setVisible(false);
  viewer.session.setVisible(false);
  assert.deepEqual(first.sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'visibility', visible: false },
  ]);

  first.fireClose();
  t.mock.timers.tick(500);
  const second = lastSocket(viewer);
  assert.notEqual(second, first);
  second.fireOpen();

  assert.deepEqual(second.sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'visibility', visible: false },
  ]);
});

test('sets the help request from help events and answers it with its id', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();

  socket.fireEvent({ type: 'help', request: { id: 'help-1', message: 'Sign in.' } });
  assert.deepEqual(viewer.session.getSnapshot().help, {
    id: 'help-1',
    message: 'Sign in.',
  });

  viewer.session.answerHelp('done');
  assert.deepEqual(socket.sent.at(-1), {
    type: 'answer-help',
    requestId: 'help-1',
    answer: 'done',
  });

  socket.fireEvent({ type: 'help', request: null });
  assert.equal(viewer.session.getSnapshot().help, undefined);
  const sentBefore = socket.sent.length;
  viewer.session.answerHelp('done');
  assert.equal(socket.sent.length, sentBefore);
});

test('reads the page text when the matching page-text event arrives', async () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();

  const text = viewer.session.readText();
  const request = socket.sent.at(-1);
  assert.ok(request !== undefined && request.type === 'read-text');
  assert.equal(typeof request.requestId, 'string');

  socket.fireEvent({
    type: 'page-text',
    requestId: request.requestId,
    title: 'Example',
    url: 'https://example.com/a',
    text: '# Example',
  });

  assert.deepEqual(await text, {
    title: 'Example',
    url: 'https://example.com/a',
    text: '# Example',
  });
});

test('rejects the page text read when the socket closes before the answer', async () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  const text = viewer.session.readText();

  socket.fireClose();

  await assert.rejects(text, { message: 'the connection to DSH was lost' });
  viewer.session.dispose();
});

test('delivers a binary frame to the sinks and keeps the last image', async () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  const frames: { header: FrameHeader; image: Uint8Array<ArrayBuffer> }[] = [];
  viewer.session.onFrame((header, image) => frames.push({ header, image }));
  const header = { seq: 7, width: 640, height: 480 };
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  socket.fireFrame(header, image);
  await flushMicrotasks();

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0]?.header, header);
  assert.deepEqual(frames[0]?.image, image);
  assert.deepEqual(viewer.session.lastImage, image);
});

test('reconnects after 500 ms and sends watch and the shown page on the new socket', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = startViewer(undefined);
  const first = lastSocket(viewer);
  first.fireOpen();
  first.fireEvent({ type: 'pages', pages: [pageA] });
  first.fireEvent({ type: 'attached', page: pageA });

  first.fireClose();
  assert.equal(viewer.session.getSnapshot().status, 'disconnected');
  assert.equal(viewer.sockets.length, 1);

  t.mock.timers.tick(500);
  assert.equal(viewer.sockets.length, 2);
  assert.equal(viewer.session.getSnapshot().status, 'connecting');
  const second = lastSocket(viewer);
  second.fireOpen();

  assert.equal(viewer.session.getSnapshot().status, 'connected');
  assert.deepEqual(second.sent, [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'attach', pageId: 'page-a', viewport: DEFAULT_VIEWPORT },
  ]);
});

test('stops reconnecting after five failed attempts and reconnects immediately when asked', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = startViewer(undefined);
  lastSocket(viewer).fireClose();
  assert.equal(viewer.session.getSnapshot().status, 'disconnected');

  for (const delay of [500, 1000, 2000, 5000, 10_000]) {
    const socketsBefore = viewer.sockets.length;
    t.mock.timers.tick(delay);
    assert.equal(viewer.sockets.length, socketsBefore + 1);
    lastSocket(viewer).fireClose();
  }
  assert.equal(viewer.sockets.length, 6);

  t.mock.timers.tick(60_000);
  assert.equal(viewer.sockets.length, 6);
  assert.equal(viewer.session.getSnapshot().status, 'disconnected');

  viewer.session.reconnect();
  assert.equal(viewer.sockets.length, 7);
  assert.equal(viewer.session.getSnapshot().status, 'connecting');
  lastSocket(viewer).fireOpen();
  assert.deepEqual(lastSocket(viewer).sent, [{ type: 'watch', sessionId: 'session-1' }]);
});

test('disposes the socket without reconnecting after its close', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();

  viewer.session.dispose();
  assert.equal(socket.readyState, 3);
  socket.fireClose();
  t.mock.timers.tick(60_000);

  assert.equal(viewer.sockets.length, 1);
});

test('shows a failed request as the notice and clears it when notified with undefined', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();

  socket.fireEvent({
    type: 'failed',
    requestType: 'navigate',
    requestId: null,
    message: 'Chrome is not running.',
  });
  assert.equal(viewer.session.getSnapshot().notice, 'Chrome is not running.');

  viewer.session.notify(undefined);
  assert.equal(viewer.session.getSnapshot().notice, undefined);
});

test('follows a newly opened page again after its own open failed', () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  socket.fireEvent({ type: 'pages', pages: [pageA] });
  socket.fireEvent({ type: 'attached', page: pageA });

  viewer.session.open('https://example.com/unreachable');
  socket.fireEvent({
    type: 'failed',
    requestType: 'open',
    requestId: null,
    message: 'bad address',
  });
  assert.equal(viewer.session.getSnapshot().notice, 'bad address');

  socket.fireEvent({ type: 'pages', pages: [pageC, pageA] });
  assert.deepEqual(socket.sent.at(-1), {
    type: 'attach',
    pageId: pageC.id,
    viewport: DEFAULT_VIEWPORT,
  });
});

test('rejects the page text read with the host failure that names it', async () => {
  const viewer = startViewer(undefined);
  const socket = lastSocket(viewer);
  socket.fireOpen();
  const text = viewer.session.readText();
  const request = socket.sent.at(-1) as { type: string; requestId: string };
  assert.equal(request.type, 'read-text');

  socket.fireEvent({
    type: 'failed',
    requestType: 'read-text',
    requestId: request.requestId,
    message: 'no page is shown',
  });

  await assert.rejects(text, { message: 'no page is shown' });
  // The reader reports the failure; the tab's notice is left to it.
  assert.equal(viewer.session.getSnapshot().notice, undefined);
  viewer.session.dispose();
});
