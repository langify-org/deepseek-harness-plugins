import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { XConnection } from '../../../../../src/host/chrome/display/x-connection.ts';
import { KeyboardFocus } from '../../../../../src/host/chrome/sessions/keyboard-focus.ts';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A fake screen: windows with bounds, one holding the focus. Session "a" owns x < 1000 and
 * session "b" x >= 1000, as `sessionAt` says. `events` records, in order, what happened.
 */
function setup(now: () => number = Date.now) {
  const events: string[] = [];
  const warnings: string[] = [];
  const windows = new Map<number, Bounds>();
  const state: {
    focused: number | undefined;
    focusFails: Set<number>;
    inputFocusError: Error | undefined;
    activate: (sessionId: string) => Promise<boolean>;
  } = {
    focused: undefined,
    focusFails: new Set(),
    inputFocusError: undefined,
    activate: async () => true,
  };
  const x = {
    inputFocus: async () => {
      if (state.inputFocusError !== undefined) throw state.inputFocusError;
      return state.focused;
    },
    focus: async (window: number) => {
      if (state.focusFails.has(window) || !windows.has(window)) throw new Error('no window');
      state.focused = window;
      events.push(`focus ${window}`);
    },
    boundsOf: async (window: number) => {
      const bounds = windows.get(window);
      if (bounds === undefined) throw new Error('no window');
      return bounds;
    },
  } as unknown as XConnection;
  let connection: XConnection | undefined = x;
  const focus = new KeyboardFocus({
    xConnection: () => connection,
    sessionAt: (px) => (px < 1000 ? 'a' : 'b'),
    activate: async (sessionId) => {
      events.push(`activate ${sessionId}`);
      return state.activate(sessionId);
    },
    log: { info: () => {}, warn: (message) => warnings.push(message) },
    now,
  });
  return {
    focus,
    events,
    warnings,
    state,
    windows,
    disconnect: () => {
      connection = undefined;
    },
    key: (name: string) => () => events.push(`key ${name}`),
  };
}

const windowOn = (left: number): Bounds => ({ x: left, y: 0, width: 400, height: 300 });

test('writes the key at once when the focused window is in the session’s screen', async () => {
  const t = setup();
  t.windows.set(1, windowOn(100));
  t.state.focused = 1;
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['key 1']);
});

test('judges a window by its middle, not its corner', async () => {
  const t = setup();
  // Starts in a's screen, but its middle (x = 1100) is in b's.
  t.windows.set(1, { x: 900, y: 0, width: 400, height: 300 });
  t.state.focused = 1;
  await t.focus.deliver('b', t.key('1'));
  assert.deepEqual(t.events, ['key 1']);
});

test('gives the focus back to the session’s window that had it last before the key', async () => {
  const t = setup();
  t.windows.set(1, windowOn(100));
  t.windows.set(2, windowOn(1100));
  t.state.focused = 1;
  await t.focus.deliver('a', t.key('1')); // remembers window 1 for a
  t.state.focused = 2; // b's window takes the focus
  await t.focus.deliver('a', t.key('2'));
  assert.deepEqual(t.events, ['key 1', 'focus 1', 'key 2']);
});

test('activates the session’s front window when the one that had the focus is gone', async () => {
  const t = setup();
  t.windows.set(1, windowOn(100));
  t.windows.set(2, windowOn(1100));
  t.state.focused = 1;
  await t.focus.deliver('a', t.key('1'));
  t.windows.delete(1);
  t.windows.set(3, windowOn(100));
  t.state.focused = 2;
  t.state.activate = async () => {
    // Chrome brings the window forward a moment later.
    setTimeout(() => {
      t.state.focused = 3;
    }, 30);
    return true;
  };
  await t.focus.deliver('a', t.key('2'));
  assert.deepEqual(t.events, ['key 1', 'activate a', 'key 2']);
  assert.equal(t.state.focused, 3);
  // The new window is remembered: the next time the focus is taken it goes back to it.
  t.state.focused = 2;
  await t.focus.deliver('a', t.key('3'));
  assert.deepEqual(t.events.slice(3), ['focus 3', 'key 3']);
});

test('activates the front window of a session that never had the focus', async () => {
  const t = setup();
  t.windows.set(2, windowOn(1100));
  t.windows.set(3, windowOn(100));
  t.state.focused = 2;
  t.state.activate = async () => {
    t.state.focused = 3;
    return true;
  };
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['activate a', 'key 1']);
});

test('still writes the key of a session that has no window', async () => {
  const t = setup();
  t.windows.set(2, windowOn(1100));
  t.state.focused = 2;
  t.state.activate = async () => false;
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['activate a', 'key 1']);
});

test('keys of two sessions are delivered one at a time, in order', async () => {
  const t = setup();
  t.windows.set(1, windowOn(100));
  t.windows.set(2, windowOn(1100));
  t.state.focused = 2;
  let finishActivation: (() => void) | undefined;
  t.state.activate = (sessionId) =>
    new Promise((resolve) => {
      const finish = () => {
        t.state.focused = sessionId === 'a' ? 1 : 2;
        resolve(true);
      };
      // Only a's activation is held back; b's finishes at once.
      if (sessionId === 'a') finishActivation = finish;
      else finish();
    });
  const first = t.focus.deliver('a', t.key('a'));
  const second = t.focus.deliver('b', t.key('b'));
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The second key has not started: b's window has the focus, but a's key is still waiting.
  assert.deepEqual(t.events, ['activate a']);
  finishActivation?.();
  await Promise.all([first, second]);
  assert.deepEqual(t.events, ['activate a', 'key a', 'activate b', 'key b']);
});

test('logs an X failure and still writes the key', async () => {
  const t = setup();
  t.state.inputFocusError = new Error('X went away');
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['key 1']);
  assert.equal(t.warnings.length, 1);
  assert.match(t.warnings[0] ?? '', /X went away/);
  // A failure does not stop the keys after it.
  await t.focus.deliver('a', t.key('2'));
  assert.deepEqual(t.events, ['key 1', 'key 2']);
});

test('writes the key at once when no X connection runs', async () => {
  const t = setup();
  t.disconnect();
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['key 1']);
  assert.deepEqual(t.warnings, []);
});

test('forgets the windows of a session after reset', async () => {
  const t = setup();
  t.windows.set(1, windowOn(100));
  t.windows.set(2, windowOn(1100));
  t.state.focused = 1;
  await t.focus.deliver('a', t.key('1'));
  t.focus.reset();
  t.state.focused = 2;
  t.state.activate = async () => false;
  await t.focus.deliver('a', t.key('2'));
  assert.deepEqual(t.events, ['key 1', 'activate a', 'key 2']);
});

test("does not ask again for a while when the session's window does not take the focus", async () => {
  let clock = 0;
  const t = setup(() => clock);
  t.windows.set(2, windowOn(1100));
  t.state.focused = 2;
  // Chrome is asked, but the session's window never takes the focus.
  await t.focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['activate a', 'key 1']);
  // The next keys go at once, to wherever the focus is, without asking Chrome again.
  clock += 1000;
  const started = Date.now();
  await t.focus.deliver('a', t.key('2'));
  assert.ok(Date.now() - started < 100, 'the key waited for the focus again');
  assert.deepEqual(t.events.slice(2), ['key 2']);
  // A while later, Chrome is asked again.
  clock += 10_000;
  await t.focus.deliver('a', t.key('3'));
  assert.deepEqual(t.events.slice(3), ['activate a', 'key 3']);
  // The failures were told once, not for each key.
  assert.equal(t.warnings.length, 1);
});

test('writes the key at once while the X connection is closed', async () => {
  const t = setup();
  t.windows.set(2, windowOn(1100));
  t.state.focused = 2;
  // A closed connection says so; asking it anything would fail.
  const closedConnection = { closed: true } as unknown as XConnection;
  const focus = new KeyboardFocus({
    xConnection: () => closedConnection,
    sessionAt: () => 'a',
    activate: async () => true,
    log: { info: () => {}, warn: (message) => t.warnings.push(message) },
  });
  await focus.deliver('a', t.key('1'));
  assert.deepEqual(t.events, ['key 1']);
  assert.deepEqual(t.warnings, []);
});
