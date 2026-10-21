import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DENIED_CDP_METHODS,
  parseExtensionMessage,
  parseHostMessage,
  parsePageList,
  parseRelayHello,
  requestIdOf,
} from '../../../src/protocol/connector.ts';

const snapshot = {
  tabId: 1,
  groupKey: 'session-1',
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
};

test('accepts a hello and drops fields the protocol does not define', () => {
  const value = {
    type: 'hello',
    protocol: 1,
    browserId: 'browser-1',
    label: 'Work Chrome',
    extensionVersion: '1.2.3',
    extra: 'drop',
  };
  const parsed = parseExtensionMessage(value);
  assert.deepEqual(parsed, {
    type: 'hello',
    protocol: 1,
    browserId: 'browser-1',
    label: 'Work Chrome',
    extensionVersion: '1.2.3',
  });
  assert.notEqual(parsed, value);
});

test('accepts a successful response and keeps its result', () => {
  assert.deepEqual(
    parseExtensionMessage({
      type: 'response',
      id: 7,
      ok: true,
      result: { value: 42 },
      extra: 'drop',
    }),
    { type: 'response', id: 7, ok: true, result: { value: 42 } },
  );
});

test('accepts a failed response with an error code the protocol defines', () => {
  assert.deepEqual(
    parseExtensionMessage({
      type: 'response',
      id: 9,
      ok: false,
      error: { code: 'not-owned', message: 'page 4 is not owned', extra: 'drop' },
      extra: 'drop',
    }),
    {
      type: 'response',
      id: 9,
      ok: false,
      error: { code: 'not-owned', message: 'page 4 is not owned' },
    },
  );
});

test('accepts a CDP event with its parameters', () => {
  assert.deepEqual(
    parseExtensionMessage({
      type: 'cdp-event',
      tabId: 4,
      method: 'Page.loadEventFired',
      params: { timestamp: 12.5 },
      extra: 'drop',
    }),
    { type: 'cdp-event', tabId: 4, method: 'Page.loadEventFired', params: { timestamp: 12.5 } },
  );
});

test('accepts a page change with a page snapshot', () => {
  const parsed = parseExtensionMessage({
    type: 'page-changed',
    page: { ...snapshot, extra: 'drop' },
    extra: 'drop',
  });
  assert.deepEqual(parsed, { type: 'page-changed', page: snapshot });
});

test('accepts a page end with either reason', () => {
  assert.deepEqual(parseExtensionMessage({ type: 'page-ended', tabId: 5, reason: 'closed' }), {
    type: 'page-ended',
    tabId: 5,
    reason: 'closed',
  });
  assert.deepEqual(
    parseExtensionMessage({ type: 'page-ended', tabId: 6, reason: 'released-by-user' }),
    {
      type: 'page-ended',
      tabId: 6,
      reason: 'released-by-user',
    },
  );
});

test('rejects extension messages that do not match the protocol', () => {
  const malformed: readonly unknown[] = [
    null,
    [],
    'hello',
    { type: 'hello', protocol: '1', browserId: 'b', label: 'l', extensionVersion: 'v' },
    { type: 'hello', protocol: 1, browserId: 'b', label: 'l' },
    { type: 'response', id: '7', ok: true, result: null },
    { type: 'response', id: 7, ok: false, error: { code: 'unknown-code', message: 'x' } },
    { type: 'response', id: 7, ok: false, error: { code: 'not-owned' } },
    { type: 'response', id: 7, ok: false, error: { code: 'not-owned', message: 42 } },
    { type: 'response', id: 7, ok: 'true' },
    { type: 'cdp-event', tabId: '4', method: 'Page.loadEventFired', params: {} },
    { type: 'cdp-event', tabId: 4, params: {} },
    { type: 'page-changed', page: { ...snapshot, loading: 'no' } },
    { type: 'page-changed' },
    { type: 'page-ended', tabId: 1, reason: 'navigated' },
    { type: 'unknown' },
  ];
  for (const value of malformed) {
    assert.equal(parseExtensionMessage(value), undefined, JSON.stringify(value));
  }
});

test('accepts a welcome with no reload and with a version to reload to', () => {
  assert.deepEqual(
    parseHostMessage({ type: 'welcome', protocol: 1, reloadTo: null, extra: 'drop' }),
    {
      type: 'welcome',
      protocol: 1,
      reloadTo: null,
    },
  );
  assert.deepEqual(parseHostMessage({ type: 'welcome', protocol: 1, reloadTo: '1.3.0' }), {
    type: 'welcome',
    protocol: 1,
    reloadTo: '1.3.0',
  });
});

test('accepts a request to open a page', () => {
  assert.deepEqual(
    parseHostMessage({
      type: 'request',
      id: 12,
      method: 'page.open',
      params: {
        url: 'https://example.com/',
        group: { key: 'session-1', title: 'DSH session', extra: 'drop' },
        extra: 'drop',
      },
      extra: 'drop',
    }),
    {
      type: 'request',
      id: 12,
      method: 'page.open',
      params: { url: 'https://example.com/', group: { key: 'session-1', title: 'DSH session' } },
    },
  );
});

test('accepts requests to close and activate a page', () => {
  assert.deepEqual(
    parseHostMessage({
      type: 'request',
      id: 2,
      method: 'page.close',
      params: { tabId: 3, extra: 'drop' },
    }),
    { type: 'request', id: 2, method: 'page.close', params: { tabId: 3 } },
  );
  assert.deepEqual(
    parseHostMessage({ type: 'request', id: 3, method: 'page.activate', params: { tabId: 3 } }),
    { type: 'request', id: 3, method: 'page.activate', params: { tabId: 3 } },
  );
});

test('accepts a request to list pages', () => {
  assert.deepEqual(parseHostMessage({ type: 'request', id: 4, method: 'page.list', params: {} }), {
    type: 'request',
    id: 4,
    method: 'page.list',
    params: {},
  });
});

test('accepts a request to send a CDP command', () => {
  assert.deepEqual(
    parseHostMessage({
      type: 'request',
      id: 5,
      method: 'cdp.send',
      params: { tabId: 1, method: 'Page.navigate', params: { url: 'https://example.com/next' } },
    }),
    {
      type: 'request',
      id: 5,
      method: 'cdp.send',
      params: { tabId: 1, method: 'Page.navigate', params: { url: 'https://example.com/next' } },
    },
  );
});

test('rejects host messages whose params do not fit the method', () => {
  const malformed: readonly unknown[] = [
    null,
    { type: 'welcome', protocol: '1', reloadTo: null },
    { type: 'welcome', protocol: 1, reloadTo: 1 },
    { type: 'welcome', protocol: 1 },
    { type: 'request', id: '1', method: 'page.list', params: {} },
    { type: 'request', id: 1, method: 'page.list' },
    { type: 'request', id: 1, method: 'page.list', params: null },
    { type: 'request', id: 1, method: 'page.open', params: { group: { key: 'k', title: 't' } } },
    { type: 'request', id: 1, method: 'page.open', params: { url: 'u', group: 'g' } },
    { type: 'request', id: 1, method: 'page.open', params: { url: 'u', group: { key: 'k' } } },
    { type: 'request', id: 1, method: 'page.close', params: {} },
    { type: 'request', id: 1, method: 'page.close', params: { tabId: '3' } },
    { type: 'request', id: 1, method: 'page.activate', params: { tabId: null } },
    { type: 'request', id: 1, method: 'cdp.send', params: { tabId: 1, method: 2, params: {} } },
    {
      type: 'request',
      id: 1,
      method: 'cdp.send',
      params: { tabId: 1, method: 'Page.navigate', params: 'url' },
    },
    { type: 'request', id: 1, method: 'cdp.send', params: { method: 'Page.navigate', params: {} } },
    { type: 'request', id: 1, method: 'page.navigate', params: { url: 'u' } },
    { type: 'event', id: 1, method: 'page.list', params: {} },
  ];
  for (const value of malformed) {
    assert.equal(parseHostMessage(value), undefined, JSON.stringify(value));
  }
});

test('reads the relay hello with the profile it names', () => {
  const value = {
    type: 'relay-hello',
    protocol: 1,
    profile: '/home/user/.config/google-chrome',
    extra: 'drop',
  };
  const parsed = parseRelayHello(value);
  assert.deepEqual(parsed, {
    type: 'relay-hello',
    protocol: 1,
    profile: '/home/user/.config/google-chrome',
  });
  assert.notEqual(parsed, value);
});

test('rejects a relay hello that does not match the protocol', () => {
  assert.equal(parseRelayHello({ type: 'relay-hello', profile: 'p' }), undefined);
  assert.equal(parseRelayHello({ type: 'relay-hello', protocol: '1', profile: 'p' }), undefined);
  assert.equal(parseRelayHello({ type: 'relay-hello', protocol: 1 }), undefined);
  assert.equal(parseRelayHello({ type: 'hello', protocol: 1, profile: 'p' }), undefined);
  assert.equal(parseRelayHello('relay-hello'), undefined);
});

test('reads a page list and drops fields a snapshot does not define', () => {
  assert.deepEqual(parsePageList({ pages: [{ ...snapshot, extra: 'drop' }], extra: 'drop' }), [
    snapshot,
  ]);
  assert.deepEqual(parsePageList({ pages: [] }), []);
});

test('rejects a page list with one entry that is not a snapshot', () => {
  assert.equal(parsePageList({ pages: [snapshot, { tabId: 2, groupKey: 'g' }] }), undefined);
  assert.equal(parsePageList({ pages: 'none' }), undefined);
  assert.equal(parsePageList({}), undefined);
  assert.equal(parsePageList(null), undefined);
});

test('reads a request id even when the rest of the request is malformed', () => {
  assert.equal(requestIdOf({ id: 42 }), 42);
  assert.equal(requestIdOf({ id: 0 }), 0);
  assert.equal(requestIdOf({ id: 42, method: 'unknown' }), 42);
});

test('returns undefined when a request id is missing or not a finite number', () => {
  assert.equal(requestIdOf({}), undefined);
  assert.equal(requestIdOf({ id: '42' }), undefined);
  assert.equal(requestIdOf({ id: Number.NaN }), undefined);
  assert.equal(requestIdOf({ id: Number.POSITIVE_INFINITY }), undefined);
  assert.equal(requestIdOf({ id: null }), undefined);
  assert.equal(requestIdOf(null), undefined);
  assert.equal(requestIdOf([]), undefined);
});

test('denies the CDP methods that read cookies', () => {
  assert.equal(DENIED_CDP_METHODS.has('Network.getCookies'), true);
  assert.equal(DENIED_CDP_METHODS.has('Network.getAllCookies'), true);
  assert.equal(DENIED_CDP_METHODS.has('Storage.getCookies'), true);
  assert.equal(DENIED_CDP_METHODS.size, 3);
});
