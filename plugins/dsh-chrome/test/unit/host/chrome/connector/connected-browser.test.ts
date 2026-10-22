import assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { test } from 'node:test';
import {
  type BrowserIdentity,
  ConnectedBrowser,
  ConnectorRequestError,
  type ConnectorRequestFailure,
} from '../../../../../src/host/chrome/connector/connected-browser.ts';
import { FrameDecoder } from '../../../../../src/host/chrome/connector/message-framing.ts';
import {
  MAX_HOST_TO_EXTENSION_BYTES,
  type PageGroup,
  type PageSnapshot,
} from '../../../../../src/protocol/connector.ts';

interface FakeSocket {
  readonly writes: Buffer[];
  readonly closeListeners: (() => void)[];
  write(frame: Buffer): void;
  once(event: string, listener: () => void): void;
  destroy(): void;
}

interface WrittenRequest {
  readonly type: 'request';
  readonly id: number;
  readonly method: string;
  readonly params: {
    readonly tabId?: number;
    readonly url?: string;
    readonly group?: PageGroup;
  };
}

const IDENTITY: BrowserIdentity = {
  profile: 'test-profile',
  browserId: 'browser-1',
  label: 'Test Chrome',
  extensionVersion: '1.0.0',
};

const GROUP: PageGroup = { key: 'session-1', title: 'DSH session' };

const PAGE: PageSnapshot = {
  tabId: 7,
  groupKey: 'session-1',
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
};

function fakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    writes: [],
    closeListeners: [],
    write(frame) {
      socket.writes.push(frame);
    },
    once(event, listener) {
      if (event === 'close') socket.closeListeners.push(listener);
    },
    destroy() {
      for (const listener of socket.closeListeners.splice(0)) listener();
    },
  };
  return socket;
}

function connect(): { readonly browser: ConnectedBrowser; readonly socket: FakeSocket } {
  const socket = fakeSocket();
  return { browser: new ConnectedBrowser(socket as unknown as Socket, IDENTITY), socket };
}

function writtenRequests(socket: FakeSocket): WrittenRequest[] {
  const decoder = new FrameDecoder(MAX_HOST_TO_EXTENSION_BYTES);
  const frames = decoder.push(Buffer.concat(socket.writes));
  return frames as WrittenRequest[];
}

function isRequestError(code: ConnectorRequestFailure): (error: unknown) => boolean {
  return (error) => error instanceof ConnectorRequestError && error.code === code;
}

test('closes the tab a timed-out open leaves behind when the late answer arrives', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());

  const opening = browser.openPage(PAGE.url, GROUP, { timeoutMs: 20 });
  await assert.rejects(
    opening,
    (error: unknown) =>
      error instanceof ConnectorRequestError &&
      error.code === 'timeout' &&
      error.message === 'page.open got no answer in 20 ms',
  );

  const [open] = writtenRequests(socket);
  assert.ok(open !== undefined);
  assert.equal(open.method, 'page.open');
  assert.deepEqual(open.params, { url: PAGE.url, group: GROUP });

  browser.receive({ type: 'response', id: open.id, ok: true, result: PAGE });

  const close = writtenRequests(socket).find((request) => request.method === 'page.close');
  assert.ok(close !== undefined);
  assert.deepEqual(close.params, { tabId: 7 });

  browser.receive({ type: 'response', id: close.id, ok: true, result: null });
  assert.deepEqual(
    writtenRequests(socket).map((request) => request.method),
    ['page.open', 'page.close'],
  );
});

test('writes no close when the late answer reports a failure', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());

  const opening = browser.openPage(PAGE.url, GROUP, { timeoutMs: 20 });
  await assert.rejects(opening, isRequestError('timeout'));

  const [open] = writtenRequests(socket);
  assert.ok(open !== undefined);

  browser.receive({
    type: 'response',
    id: open.id,
    ok: false,
    error: { code: 'chrome-error', message: 'the tab could not be opened' },
  });

  assert.deepEqual(
    writtenRequests(socket).map((request) => request.method),
    ['page.open'],
  );
});

test('closes the tab a late answer opens after the host aborts the wait', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());

  const controller = new AbortController();
  const reason = new Error('the tool call was stopped');
  const opening = browser.openPage(PAGE.url, GROUP, {
    signal: controller.signal,
    timeoutMs: 1000,
  });

  const [open] = writtenRequests(socket);
  assert.ok(open !== undefined);
  assert.equal(open.method, 'page.open');

  controller.abort(reason);
  await assert.rejects(opening, (error: unknown) => error === reason);

  browser.receive({ type: 'response', id: open.id, ok: true, result: PAGE });

  const close = writtenRequests(socket).find((request) => request.method === 'page.close');
  assert.ok(close !== undefined);
  assert.deepEqual(close.params, { tabId: 7 });

  browser.receive({ type: 'response', id: close.id, ok: true, result: null });
});

test('sends nothing when the signal has already aborted', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());

  const controller = new AbortController();
  const reason = new Error('already stopped');
  controller.abort(reason);

  const opening = browser.openPage(PAGE.url, GROUP, { signal: controller.signal });
  await assert.rejects(opening, (error: unknown) => error === reason);
  assert.deepEqual(socket.writes, []);

  browser.receive({ type: 'response', id: 1, ok: true, result: PAGE });
  assert.deepEqual(socket.writes, []);
});

test('resolves an open answered in time and writes no close', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());

  const opening = browser.openPage(PAGE.url, GROUP, { timeoutMs: 1000 });
  const [open] = writtenRequests(socket);
  assert.ok(open !== undefined);

  browser.receive({ type: 'response', id: open.id, ok: true, result: PAGE });

  assert.deepEqual(await opening, PAGE);
  assert.deepEqual(
    writtenRequests(socket).map((request) => request.method),
    ['page.open'],
  );
});

test('knows the tab in front only where nobody sees the windows, as the host moves it', async (t) => {
  const socket = fakeSocket();
  const hidden = new ConnectedBrowser(socket as unknown as Socket, IDENTITY, {
    visibleWindows: false,
  });
  t.after(() => hidden.disconnect());
  const answer = (method: string, result: unknown) => {
    const request = writtenRequests(socket).findLast((written) => written.method === method);
    assert.ok(request !== undefined, method);
    hidden.receive({ type: 'response', id: request.id, ok: true, result });
  };

  const opening = hidden.openPage(PAGE.url, GROUP);
  answer('page.open', PAGE);
  await opening;
  assert.equal(hidden.isInFront(PAGE.tabId), true);

  const activating = hidden.activatePage(9);
  answer('page.activate', null);
  await activating;
  assert.deepEqual([hidden.isInFront(9), hidden.isInFront(PAGE.tabId)], [true, false]);

  // A page opened in front takes the focus; one opened behind does not.
  hidden.receive({
    type: 'page-opened',
    page: { ...PAGE, tabId: 11 },
    openerTabId: 9,
    foreground: false,
  });
  assert.equal(hidden.isInFront(9), true);
  hidden.receive({
    type: 'page-opened',
    page: { ...PAGE, tabId: 12 },
    openerTabId: 9,
    foreground: true,
  });
  assert.equal(hidden.isInFront(12), true);
});

test('never claims a tab is in front where someone sees the windows', async (t) => {
  const { browser, socket } = connect();
  t.after(() => browser.disconnect());
  const activating = browser.activatePage(9);
  const [request] = writtenRequests(socket);
  assert.ok(request !== undefined);
  browser.receive({ type: 'response', id: request.id, ok: true, result: null });
  await activating;
  assert.equal(browser.visibleWindows, true);
  assert.equal(browser.isInFront(9), false);
});
