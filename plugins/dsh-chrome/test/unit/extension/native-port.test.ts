import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { NativePort } from '../../../src/extension/native-port.ts';
import { LASTING_CONNECTION_MS } from '../../../src/protocol/connector.ts';

/** A stand-in for `chrome.runtime`'s native ports, recording when each one connects. */
interface FakeRuntime {
  readonly connectedAt: number[];
  /** Ends the open port, as Chrome does when the relay exits. */
  disconnect(): void;
}

function fakeRuntime(): FakeRuntime {
  let onDisconnect: (() => void) | undefined;
  const runtime: FakeRuntime = {
    connectedAt: [],
    disconnect: () => {
      const listener = onDisconnect;
      onDisconnect = undefined;
      listener?.();
    },
  };
  const chrome = {
    runtime: {
      lastError: undefined,
      connectNative: () => {
        runtime.connectedAt.push(Date.now());
        return {
          onMessage: { addListener: () => {} },
          onDisconnect: {
            addListener: (listener: () => void) => {
              onDisconnect = listener;
            },
          },
          postMessage: () => {},
        };
      },
    },
  };
  Object.assign(globalThis, { chrome });
  return runtime;
}

function start(t: TestContext): { readonly runtime: FakeRuntime; readonly port: NativePort } {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'chrome');
  });
  const runtime = fakeRuntime();
  const port = new NativePort('io.example.host', { onOpen: () => {}, onMessage: () => {} });
  port.open();
  return { runtime, port };
}

test('tries once when no host answers, leaving the next try to the alarm', (t) => {
  const { runtime } = start(t);
  runtime.disconnect();
  t.mock.timers.tick(10 * 60_000);
  assert.equal(runtime.connectedAt.length, 1);
});

test('retries with a growing delay after a host it reached for a while goes away', (t) => {
  const { runtime, port } = start(t);
  port.confirmHost();
  t.mock.timers.tick(LASTING_CONNECTION_MS);
  const lostAt = Date.now();
  runtime.disconnect();
  for (const delay of [500, 1000, 2000, 4000]) {
    t.mock.timers.tick(delay);
    runtime.disconnect();
  }
  assert.deepEqual(
    runtime.connectedAt.slice(1).map((at) => at - lostAt),
    [500, 1500, 3500, 7500],
  );
});

test('does not keep reconnecting to a host that answers and drops the connection at once', (t) => {
  const { runtime, port } = start(t);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    port.confirmHost();
    runtime.disconnect();
    t.mock.timers.tick(30_000);
    port.open();
  }
  // One connection per explicit open: no retries of its own.
  assert.equal(runtime.connectedAt.length, 6);
});

test('stops retrying on its own a few minutes after the host went away', (t) => {
  const { runtime, port } = start(t);
  port.confirmHost();
  t.mock.timers.tick(LASTING_CONNECTION_MS);
  runtime.disconnect();
  for (let minute = 0; minute < 10; minute += 1) {
    t.mock.timers.tick(20_000);
    runtime.disconnect();
    t.mock.timers.tick(20_000);
    runtime.disconnect();
    t.mock.timers.tick(20_000);
    runtime.disconnect();
  }
  const last = runtime.connectedAt.at(-1) ?? 0;
  const first = runtime.connectedAt[1] ?? 0;
  assert.ok(last - first <= 5 * 60_000, `retried for ${last - first} ms`);
});

test('opening an open port does not connect again', (t) => {
  const { runtime, port } = start(t);
  port.open();
  port.open();
  assert.equal(runtime.connectedAt.length, 1);
});
