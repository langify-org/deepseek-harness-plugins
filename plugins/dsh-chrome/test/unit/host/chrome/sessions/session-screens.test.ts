import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScreenLayout } from '../../../../../src/host/chrome/display/screen-control.ts';
import {
  MAX_SCREEN_WIDTH,
  PARKING_MONITOR_ID,
  SessionScreens,
} from '../../../../../src/host/chrome/sessions/session-screens.ts';
import type { Log } from '../../../../../src/host/platform/log.ts';

function recorder(): { log: Log; warnings: string[] } {
  const warnings: string[] = [];
  return { log: { info: () => {}, warn: (message) => warnings.push(message) }, warnings };
}

function newScreens(): { screens: SessionScreens; warnings: string[] } {
  const { log, warnings } = recorder();
  return { screens: new SessionScreens(() => ({ width: 1000, height: 800 }), log), warnings };
}

/** An apply that finishes only when the test says so, to hold a layout "being applied". */
function gatedApply(): {
  apply: (layout: ScreenLayout) => Promise<void>;
  applied: ScreenLayout[];
  started: ScreenLayout[];
  release: () => void;
} {
  const applied: ScreenLayout[] = [];
  const started: ScreenLayout[] = [];
  const waiting: (() => void)[] = [];
  return {
    applied,
    started,
    apply: async (layout) => {
      started.push(layout);
      await new Promise<void>((resolve) => waiting.push(resolve));
      applied.push(layout);
    },
    release: () => waiting.shift()?.(),
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a new screen has one empty monitor of the default size', () => {
  const { screens } = newScreens();
  assert.deepEqual(screens.layout, {
    width: 1000,
    height: 800,
    monitors: [{ id: 1, x: 0, y: 0, width: 1000, height: 800 }],
  });
  assert.deepEqual(screens.sessions, []);
});

test('ensure gives a session a screen of the default size, once', () => {
  const { screens } = newScreens();
  screens.ensure('a');
  screens.set('a', { width: 500, height: 400 });
  screens.ensure('a');
  assert.deepEqual(screens.sessions, ['a']);
  assert.deepEqual(screens.layout.monitors, [{ id: 1, x: 0, y: 0, width: 500, height: 400 }]);
});

test('sessions get monitors side by side, and the screen is as tall as the tallest', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  screens.set('b', { width: 700, height: 900 });
  assert.deepEqual(screens.layout, {
    width: 1300,
    height: 900,
    monitors: [
      { id: 1, x: 0, y: 0, width: 600, height: 400 },
      { id: 2, x: 600, y: 0, width: 700, height: 900 },
    ],
  });
  assert.deepEqual(screens.sessions, ['a', 'b']);
});

test('a session that is resized keeps its monitor id', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  screens.set('b', { width: 700, height: 500 });
  screens.set('a', { width: 800, height: 400 });
  assert.deepEqual(
    screens.layout.monitors.map((monitor) => [monitor.id, monitor.x, monitor.width]),
    [
      [1, 0, 800],
      [2, 800, 700],
    ],
  );
});

test('a slot a session gives up keeps its size and id until another session takes it', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  screens.set('b', { width: 700, height: 500 });
  screens.remove('a');
  assert.deepEqual(screens.sessions, ['b']);
  assert.equal(screens.layout.monitors.length, 2);
  assert.deepEqual(screens.layout.monitors[0], { id: 1, x: 0, y: 0, width: 600, height: 400 });
  screens.set('c', { width: 300, height: 300 });
  assert.deepEqual(screens.sessions, ['c', 'b']);
  assert.deepEqual(screens.layout.monitors[0], { id: 1, x: 0, y: 0, width: 300, height: 300 });
});

test('empty trailing slots go, but the screen always keeps one monitor', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  screens.set('b', { width: 700, height: 500 });
  screens.remove('b');
  assert.equal(screens.layout.monitors.length, 1);
  screens.remove('a');
  assert.equal(screens.layout.monitors.length, 1);
  assert.deepEqual(screens.sessions, []);
  screens.remove('unknown');
  assert.equal(screens.layout.monitors.length, 1);
});

test('set throws when the screen would pass the widest, and leaves the layout as it was', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 8192, height: 400 });
  screens.set('b', { width: 8192, height: 400 });
  assert.equal(screens.layout.width, MAX_SCREEN_WIDTH);
  const before = screens.layout;
  assert.throws(() => screens.set('c', { width: 200, height: 200 }), /no room/);
  assert.deepEqual(screens.layout, before);
  assert.deepEqual(screens.sessions, ['a', 'b']);
});

test('a resize that would pass the widest throws and keeps the old size', () => {
  const { screens } = newScreens();
  for (const id of ['a', 'b', 'c']) screens.set(id, { width: 5000, height: 400 });
  assert.throws(() => screens.set('c', { width: 7000, height: 400 }), /no room/);
  assert.equal(screens.layout.monitors[2]?.width, 5000);
  assert.equal(screens.layout.width, 15_000);
});

test('a session that does not fit leaves no slot of its own behind', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 8192, height: 400 });
  screens.set('b', { width: 8192, height: 400 });
  screens.remove('b');
  screens.set('b', { width: 8192, height: 400 });
  assert.throws(() => screens.set('c', { width: 200, height: 200 }));
  assert.deepEqual(screens.sessions, ['a', 'b']);
  assert.equal(screens.layout.monitors.length, 2);
});

test('sizes are rounded and clamped to what a session screen can be', () => {
  const { screens } = newScreens();
  screens.set('a', { width: 10, height: 99_999 });
  assert.deepEqual(screens.layout.monitors[0], { id: 1, x: 0, y: 0, width: 200, height: 8192 });
  screens.set('a', { width: 500.6, height: 300.4 });
  assert.deepEqual(screens.layout.monitors[0], { id: 1, x: 0, y: 0, width: 501, height: 300 });
});

test('monitorOf and sessionAt answer nothing until a layout is applied', async () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  assert.equal(screens.monitorOf('a'), undefined);
  assert.equal(screens.sessionAt(10, 10), undefined);
  screens.attach(async () => {});
  await screens.settled();
  assert.deepEqual(screens.monitorOf('a'), { id: 1, x: 0, y: 0, width: 600, height: 400 });
  assert.equal(screens.monitorOf('nobody'), undefined);
});

test('sessionAt finds the session whose monitor holds the point', async () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  screens.set('b', { width: 700, height: 500 });
  screens.attach(async () => {});
  await screens.settled();
  assert.equal(screens.sessionAt(0, 0), 'a');
  assert.equal(screens.sessionAt(599, 399), 'a');
  assert.equal(screens.sessionAt(600, 0), 'b');
  assert.equal(screens.sessionAt(1299, 499), 'b');
  assert.equal(screens.sessionAt(1300, 0), undefined);
  assert.equal(screens.sessionAt(0, 400), undefined);
  assert.equal(screens.sessionAt(-1, 0), undefined);
});

test('attach applies the layout asked for so far, and settled resolves once it is applied', async () => {
  const { screens } = newScreens();
  const layouts: ScreenLayout[] = [];
  screens.set('a', { width: 600, height: 400 });
  screens.attach(async (layout) => {
    layouts.push(layout);
  });
  await screens.settled();
  assert.deepEqual(layouts, [screens.layout]);
});

test('while a layout is applied, later changes wait and only the last is applied', async () => {
  const { screens } = newScreens();
  const gate = gatedApply();
  screens.attach(gate.apply);
  await tick();
  assert.equal(gate.started.length, 1);
  screens.set('a', { width: 300, height: 300 });
  screens.set('a', { width: 400, height: 400 });
  screens.set('a', { width: 500, height: 500 });
  await tick();
  assert.equal(gate.started.length, 1, 'no second apply starts while the first runs');
  gate.release();
  await tick();
  assert.equal(gate.started.length, 2);
  gate.release();
  await screens.settled();
  assert.deepEqual(gate.applied.at(-1)?.monitors, [{ id: 1, x: 0, y: 0, width: 500, height: 500 }]);
  assert.equal(gate.started.length, 2);
});

test('monitorOf answers from the layout as applied, not as asked', async () => {
  const { screens } = newScreens();
  const gate = gatedApply();
  screens.set('a', { width: 600, height: 400 });
  screens.attach(gate.apply);
  await tick();
  assert.equal(screens.monitorOf('a'), undefined);
  gate.release();
  await tick();
  screens.set('a', { width: 800, height: 400 });
  await tick();
  assert.equal(screens.monitorOf('a')?.width, 600);
  assert.equal(screens.sessionAt(700, 10), undefined);
  gate.release();
  await screens.settled();
  assert.equal(screens.monitorOf('a')?.width, 800);
  assert.equal(screens.sessionAt(700, 10), 'a');
});

test('onChange fires after each applied layout, and not after it is unsubscribed', async () => {
  const { screens } = newScreens();
  let changes = 0;
  const stop = screens.onChange(() => {
    changes += 1;
  });
  screens.attach(async () => {});
  await screens.settled();
  assert.equal(changes, 1);
  screens.set('a', { width: 600, height: 400 });
  await screens.settled();
  assert.equal(changes, 2);
  stop();
  screens.set('a', { width: 700, height: 400 });
  await screens.settled();
  assert.equal(changes, 2);
});

test('a layout the screen already has is not applied again', async () => {
  const { screens } = newScreens();
  let calls = 0;
  screens.attach(async () => {
    calls += 1;
  });
  await screens.settled();
  screens.set('a', { width: 1000, height: 800 });
  await screens.settled();
  assert.equal(calls, 1);
});

test('an apply that throws is logged, and the next change tries again', async () => {
  const { screens, warnings } = newScreens();
  let fail = true;
  const layouts: ScreenLayout[] = [];
  let changes = 0;
  screens.onChange(() => {
    changes += 1;
  });
  screens.set('a', { width: 600, height: 400 });
  screens.attach(async (layout) => {
    layouts.push(layout);
    if (fail) throw new Error('boom');
  });
  await screens.settled();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /boom/);
  assert.equal(changes, 0);
  assert.equal(screens.monitorOf('a'), undefined);
  fail = false;
  screens.set('b', { width: 300, height: 300 });
  await screens.settled();
  assert.equal(layouts.length, 2);
  assert.equal(changes, 1);
  assert.equal(screens.monitorOf('b')?.id, 2);
});

test('after detach no layout is applied, and nothing is answered from the old screen', async () => {
  const { screens } = newScreens();
  let calls = 0;
  screens.set('a', { width: 600, height: 400 });
  screens.attach(async () => {
    calls += 1;
  });
  await screens.settled();
  screens.detach();
  assert.equal(screens.monitorOf('a'), undefined);
  assert.equal(screens.sessionAt(10, 10), undefined);
  screens.set('a', { width: 700, height: 400 });
  await screens.settled();
  assert.equal(calls, 1);
});

test('a layout still being applied when the screen detaches is not taken as applied', async () => {
  const { screens } = newScreens();
  const gate = gatedApply();
  let changes = 0;
  screens.onChange(() => {
    changes += 1;
  });
  screens.set('a', { width: 600, height: 400 });
  screens.attach(gate.apply);
  await tick();
  screens.detach();
  gate.release();
  await screens.settled();
  assert.equal(changes, 0);
  assert.equal(screens.monitorOf('a'), undefined);
});

test('settled resolves at once when no screen runs', async () => {
  const { screens } = newScreens();
  screens.set('a', { width: 600, height: 400 });
  await screens.settled();
});

test('the parking monitor stands right of the sessions’ monitors while it is wanted, of the default size', async () => {
  const { screens } = newScreens();
  screens.set('a', { width: 1200, height: 900 });
  screens.setParking(true);
  assert.deepEqual(
    screens.layout.monitors.map(({ id, x, width }) => [id, x, width]),
    [
      [1, 0, 1200],
      [PARKING_MONITOR_ID, 1200, 1000],
    ],
  );
  const gate = gatedApply();
  screens.attach(gate.apply);
  await tick();
  gate.release();
  await screens.settled();
  assert.deepEqual(screens.parkingMonitor, {
    id: PARKING_MONITOR_ID,
    x: 1200,
    y: 0,
    width: 1000,
    height: 800,
  });
  // A point on the parking monitor is no session's.
  assert.equal(screens.sessionAt(1300, 10), undefined);
  assert.equal(screens.sessionAt(10, 10), 'a');
  screens.setParking(false);
  assert.deepEqual(
    screens.layout.monitors.map(({ id }) => id),
    [1],
  );
});

test('with only the parking monitor wanted, the screen has no empty slot beside it', () => {
  const { screens } = newScreens();
  screens.setParking(true);
  assert.deepEqual(
    screens.layout.monitors.map(({ id }) => id),
    [PARKING_MONITOR_ID],
  );
  screens.setParking(false);
  // Without it, the screen keeps one monitor, as always.
  assert.equal(screens.layout.monitors.length, 1);
});

test('the parking monitor counts toward the widest screen', () => {
  const { screens } = newScreens();
  screens.setParking(true);
  screens.set('a', { width: 8192, height: 800 });
  // 8192 + 8192 fit without the parking monitor; with it, they do not.
  assert.throws(() => screens.set('b', { width: 8192, height: 800 }), /no room/);
});

test('a listener that throws is logged, and later layouts are applied all the same', async () => {
  const { screens, warnings } = newScreens();
  screens.onChange(() => {
    throw new Error('listener failed');
  });
  const applied: ScreenLayout[] = [];
  screens.attach(async (layout) => {
    applied.push(layout);
  });
  await screens.settled();
  screens.set('a', { width: 1200, height: 900 });
  await screens.settled();
  assert.equal(applied.length, 2);
  assert.ok(warnings.some((warning) => warning.includes('listener failed')));
});
