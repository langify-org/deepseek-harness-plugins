import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ConnectedBrowser,
  RequestOptions,
} from '../../../src/host/runtime/connected-browser.ts';
import {
  boundToSignal,
  type ChromePage,
  type PageEnding,
} from '../../../src/host/runtime/pages.ts';
import type { PageOpener } from '../../../src/protocol/viewer.ts';

interface SendCall {
  readonly method: string;
  readonly params: unknown;
  readonly options: RequestOptions | undefined;
}

interface ListenerCall {
  readonly event: string;
  readonly listener: unknown;
}

interface FakePage {
  readonly id: string;
  readonly sessionId: string;
  readonly browser: ConnectedBrowser;
  readonly tabId: number;
  readonly openedBy: PageOpener | undefined;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly ending: PageEnding | undefined;
  readonly sends: SendCall[];
  readonly onCalls: ListenerCall[];
  readonly changedListeners: ((page: ChromePage) => void)[];
  readonly endedListeners: ((ending: PageEnding) => void)[];
  activated: number;
  closed: number;
  send(method: string, params: unknown, options: RequestOptions | undefined): Promise<unknown>;
  on(event: string, listener: unknown): () => void;
  onChanged(listener: (page: ChromePage) => void): () => void;
  onEnded(listener: (ending: PageEnding) => void): () => void;
  activate(): Promise<void>;
  close(): Promise<void>;
}

function fakePage(): FakePage {
  const page: FakePage = {
    id: 'p1',
    sessionId: 'session-1',
    browser: {} as unknown as ConnectedBrowser,
    tabId: 7,
    openedBy: 'agent',
    url: 'https://example.com/',
    title: 'Example',
    loading: true,
    ending: 'closed',
    sends: [],
    onCalls: [],
    changedListeners: [],
    endedListeners: [],
    activated: 0,
    closed: 0,
    send(method, params, options) {
      page.sends.push({ method, params, options });
      return Promise.resolve({});
    },
    on(event, listener) {
      page.onCalls.push({ event, listener });
      return () => {};
    },
    onChanged(listener) {
      page.changedListeners.push(listener);
      return () => {};
    },
    onEnded(listener) {
      page.endedListeners.push(listener);
      return () => {};
    },
    activate() {
      page.activated += 1;
      return Promise.resolve();
    },
    close() {
      page.closed += 1;
      return Promise.resolve();
    },
  };
  return page;
}

function asChromePage(page: FakePage): ChromePage {
  return page as unknown as ChromePage;
}

test('sends each command with the operation signal', async () => {
  const page = fakePage();
  const signal = new AbortController().signal;
  const bound = boundToSignal(asChromePage(page), signal);

  await bound.send('Page.getFrameTree');

  assert.equal(page.sends.length, 1);
  assert.equal(page.sends[0]?.method, 'Page.getFrameTree');
  assert.equal(page.sends[0]?.options?.signal, signal);
});

test('aborts the combined signal when either the call or the operation aborts', async () => {
  const page = fakePage();
  const operation = new AbortController();
  const bound = boundToSignal(asChromePage(page), operation.signal);

  const firstCall = new AbortController();
  await bound.send('Page.getFrameTree', undefined, { signal: firstCall.signal });
  const first = page.sends[0]?.options?.signal;
  assert.notEqual(first, undefined);
  assert.notEqual(first, firstCall.signal);
  assert.notEqual(first, operation.signal);
  assert.equal(first?.aborted, false);
  firstCall.abort();
  assert.equal(first?.aborted, true);

  const secondCall = new AbortController();
  await bound.send('Page.getFrameTree', undefined, { signal: secondCall.signal });
  const second = page.sends[1]?.options?.signal;
  assert.notEqual(second, undefined);
  assert.equal(second?.aborted, false);
  operation.abort();
  assert.equal(second?.aborted, true);
});

test('keeps the options of the command it forwards', async () => {
  const page = fakePage();
  const signal = new AbortController().signal;
  const bound = boundToSignal(asChromePage(page), signal);

  await bound.send('Page.getFrameTree', undefined, { timeoutMs: 25 });

  assert.equal(page.sends[0]?.options?.timeoutMs, 25);
  assert.equal(page.sends[0]?.options?.signal, signal);
});

test('reads the page id, session, browser, tab, opener, address, title, loading, and ending', () => {
  const page = fakePage();
  const bound = boundToSignal(asChromePage(page), new AbortController().signal);

  assert.equal(bound.id, 'p1');
  assert.equal(bound.sessionId, 'session-1');
  assert.equal(bound.browser, page.browser);
  assert.equal(bound.tabId, 7);
  assert.equal(bound.openedBy, 'agent');
  assert.equal(bound.url, 'https://example.com/');
  assert.equal(bound.title, 'Example');
  assert.equal(bound.loading, true);
  assert.equal(bound.ending, 'closed');
});

test('passes listeners, changes, activation, and closing through to the page', async () => {
  const page = fakePage();
  const bound = boundToSignal(asChromePage(page), new AbortController().signal);

  const listener = () => undefined;
  bound.on('Page.loadEventFired', listener);
  assert.equal(page.onCalls.length, 1);
  assert.equal(page.onCalls[0]?.event, 'Page.loadEventFired');
  assert.equal(page.onCalls[0]?.listener, listener);

  const changedListener = () => undefined;
  bound.onChanged(changedListener);
  assert.equal(page.changedListeners[0], changedListener);

  const endedListener = () => undefined;
  bound.onEnded(endedListener);
  assert.equal(page.endedListeners[0], endedListener);

  await bound.activate();
  await bound.close();
  assert.equal(page.activated, 1);
  assert.equal(page.closed, 1);
});
