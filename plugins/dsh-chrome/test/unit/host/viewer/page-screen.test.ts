import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { ChromePage, PageEnding } from '../../../../src/host/chrome/pages/page.ts';
import { silentLog } from '../../../../src/host/platform/log.ts';
import {
  PageScreen,
  type ScreenFrame,
  type ScreenOptions,
  ScreenRegistry,
} from '../../../../src/host/viewer/page-screen.ts';
import type { Viewport } from '../../../../src/protocol/viewer.ts';

// PageScreen keeps these timings private; the tests hold it to their values.
/** The delay between a layout change and the capture that checks it. */
const LAYOUT_CAPTURE_MS = 300;
/** The wait between captures while a visible page sends no screencast frames. */
const STALLED_CAPTURE_MS = 1000;
/** The delay after input before the page is captured. */
const INPUT_CAPTURE_MS = 80;

const options: ScreenOptions = {
  jpegQuality: 70,
  hiddenFrameIntervalMs: 250,
  maxDeviceScaleFactor: 2,
};

const defaultViewport: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1 };

interface SentCommand {
  readonly method: string;
  readonly params: Record<string, unknown> | undefined;
}

interface FakePage {
  readonly id: string;
  ending: PageEnding | undefined;
  readonly calls: SentCommand[];
  /** The base64 image the next Page.captureScreenshot returns. */
  screenshotData: string;
  /** The CSS viewport Page.getLayoutMetrics reports. */
  layoutWidth: number;
  layoutHeight: number;
  activateCount: number;
  activate(): Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (params: unknown) => void): () => void;
  onEnded(listener: (ending: PageEnding) => void): () => void;
  emit(event: string, params: unknown): void;
}

function fakePage(id = 'page-a'): FakePage {
  const events = new Map<string, Set<(params: unknown) => void>>();
  const endListeners = new Set<(ending: PageEnding) => void>();
  const page: FakePage = {
    id,
    ending: undefined,
    calls: [],
    screenshotData: 'first-image',
    layoutWidth: 1024,
    layoutHeight: 768,
    activateCount: 0,
    activate() {
      page.activateCount += 1;
      return Promise.resolve();
    },
    send(method, params) {
      page.calls.push({ method, params });
      if (method === 'Page.captureScreenshot')
        return Promise.resolve({ data: page.screenshotData });
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: { clientWidth: page.layoutWidth, clientHeight: page.layoutHeight },
        });
      }
      return Promise.resolve({});
    },
    on(event, listener) {
      const listeners = events.get(event) ?? new Set();
      events.set(event, listeners);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onEnded(listener) {
      endListeners.add(listener);
      return () => {
        endListeners.delete(listener);
      };
    },
    emit(event, params) {
      for (const listener of events.get(event) ?? []) listener(params);
    },
  };
  return page;
}

interface FakeViewer {
  viewport: Viewport;
  visible: boolean;
  readonly frames: ScreenFrame[];
  showFrame(frame: ScreenFrame): void;
}

function fakeViewer(viewport: Viewport = defaultViewport): FakeViewer {
  const viewer: FakeViewer = {
    viewport,
    visible: true,
    frames: [],
    showFrame(frame) {
      viewer.frames.push(frame);
    },
  };
  return viewer;
}

function startScreen(): { readonly page: FakePage; readonly screen: PageScreen } {
  const page = fakePage();
  return { page, screen: new PageScreen(page as unknown as ChromePage, options, silentLog) };
}

/** Lets the promise chain behind page commands run to its end. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        resolve();
      });
    });
  }
}

async function advance(t: TestContext, milliseconds: number): Promise<void> {
  t.mock.timers.tick(milliseconds);
  await flush();
}

function callsTo(page: FakePage, method: string): readonly SentCommand[] {
  return page.calls.filter((call) => call.method === method);
}

function overrideParams(page: FakePage): readonly (Record<string, unknown> | undefined)[] {
  return callsTo(page, 'Emulation.setDeviceMetricsOverride').map((call) => call.params);
}

function captureCount(page: FakePage): number {
  return callsTo(page, 'Page.captureScreenshot').length;
}

test('adding a visible viewer activates the page, lays it out, and starts a jpeg screencast', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  const viewer = fakeViewer({ width: 1024.6, height: 767.4, deviceScaleFactor: 3 });

  screen.addViewer(viewer);
  await flush();

  assert.equal(screen.viewerCount, 1);
  assert.equal(page.activateCount, 1);
  assert.deepEqual(
    page.calls.map((call) => call.method),
    [
      'Emulation.setDeviceMetricsOverride',
      'Page.enable',
      'Page.stopScreencast',
      'Page.startScreencast',
    ],
  );
  assert.deepEqual(overrideParams(page)[0], {
    width: 1025,
    height: 767,
    deviceScaleFactor: 2,
    mobile: false,
  });
  assert.deepEqual(page.calls[3]?.params, { format: 'jpeg', quality: 70 });
});

test('acknowledges a layout-sized screencast frame and shows it to every viewer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  const first = fakeViewer();
  const second = fakeViewer();
  screen.addViewer(first);
  screen.addViewer(second);
  await flush();

  const data = Buffer.from('screencast frame').toString('base64');
  page.emit('Page.screencastFrame', {
    data,
    metadata: { deviceWidth: 1024, deviceHeight: 768 },
    sessionId: 7,
  });

  assert.deepEqual(callsTo(page, 'Page.screencastFrameAck')[0]?.params, { sessionId: 7 });
  assert.equal(first.frames.length, 1);
  assert.deepEqual(first.frames[0], {
    image: Buffer.from(data, 'base64'),
    width: 1024,
    height: 768,
  });
  assert.deepEqual(second.frames[0], first.frames[0]);
});

test('captures the page 300 ms after the layout and then once per stalled second', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  screen.addViewer(fakeViewer());
  await flush();

  await advance(t, LAYOUT_CAPTURE_MS - 1);
  assert.equal(captureCount(page), 0);

  await advance(t, 1);
  assert.equal(captureCount(page), 1);

  await advance(t, STALLED_CAPTURE_MS - 1);
  assert.equal(captureCount(page), 1);

  await advance(t, 1);
  assert.equal(captureCount(page), 2);
});

test('shows a capture only when its image changed, and shows a repeat after a screencast frame', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  page.screenshotData = 'capture-one';
  const viewer = fakeViewer();
  screen.addViewer(viewer);
  await flush();

  await advance(t, LAYOUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);
  assert.equal(viewer.frames.length, 1);

  await advance(t, STALLED_CAPTURE_MS);
  assert.equal(captureCount(page), 2);
  assert.equal(viewer.frames.length, 1);

  page.emit('Page.screencastFrame', {
    data: 'screencast-frame',
    metadata: { deviceWidth: 1024, deviceHeight: 768 },
    sessionId: 1,
  });
  assert.equal(viewer.frames.length, 2);

  page.screenshotData = 'capture-one';
  await advance(t, STALLED_CAPTURE_MS);
  assert.equal(captureCount(page), 3);
  assert.equal(viewer.frames.length, 3);
  assert.deepEqual(viewer.frames[2]?.image, Buffer.from('capture-one', 'base64'));
});

test('captures a hidden page every hiddenFrameIntervalMs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  screen.addViewer(fakeViewer());
  await flush();
  await advance(t, LAYOUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);

  page.emit('Page.screencastVisibilityChanged', { visible: false });
  await advance(t, options.hiddenFrameIntervalMs - 1);
  assert.equal(captureCount(page), 1);

  await advance(t, 1);
  assert.equal(captureCount(page), 2);

  await advance(t, options.hiddenFrameIntervalMs);
  assert.equal(captureCount(page), 3);
});

test('captures 80 ms after input and does not postpone that capture for later input', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  screen.addViewer(fakeViewer());
  await flush();

  screen.inputDispatched();
  await advance(t, 40);
  screen.inputDispatched();
  await advance(t, INPUT_CAPTURE_MS - 40 - 1);
  assert.equal(captureCount(page), 0);

  await advance(t, 1);
  assert.equal(captureCount(page), 1);

  screen.inputDispatched();
  screen.inputDispatched();
  await advance(t, INPUT_CAPTURE_MS);
  assert.equal(captureCount(page), 2);
});

test('lets a screencast frame replace the capture armed by input with the regular wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  screen.addViewer(fakeViewer());
  await flush();
  await advance(t, LAYOUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);

  // At 500 ms the regular capture is still 800 ms away, while input arms one 80 ms away.
  await advance(t, 200);
  screen.inputDispatched();
  page.emit('Page.screencastFrame', {
    data: 'screencast-frame',
    metadata: { deviceWidth: 1024, deviceHeight: 768 },
    sessionId: 1,
  });

  await advance(t, INPUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);

  // The frame's own wait replaces both the input capture and the earlier regular one.
  await advance(t, STALLED_CAPTURE_MS - INPUT_CAPTURE_MS - 1);
  assert.equal(captureCount(page), 1);

  await advance(t, 1);
  assert.equal(captureCount(page), 2);
});

test('starts and stops the screencast as a viewer goes on and off screen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  const viewer = fakeViewer();
  viewer.visible = false;
  screen.addViewer(viewer);
  await flush();

  assert.deepEqual(
    page.calls.map((call) => call.method),
    ['Emulation.setDeviceMetricsOverride'],
  );
  await advance(t, 5 * STALLED_CAPTURE_MS);
  assert.equal(captureCount(page), 0);

  viewer.visible = true;
  screen.visibilityChanged();
  await flush();
  assert.equal(callsTo(page, 'Page.startScreencast').length, 1);
  await advance(t, LAYOUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);

  viewer.visible = false;
  screen.visibilityChanged();
  await flush();
  assert.equal(callsTo(page, 'Page.stopScreencast').length, 2);
  assert.equal(page.calls.at(-1)?.method, 'Page.stopScreencast');

  await advance(t, 10 * STALLED_CAPTURE_MS);
  assert.equal(captureCount(page), 1);
});

test('lays the page out only for the most recently added viewer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  const first = fakeViewer({ width: 800, height: 600, deviceScaleFactor: 1 });
  const second = fakeViewer({ width: 1024, height: 768, deviceScaleFactor: 1 });
  screen.addViewer(first);
  await flush();
  screen.addViewer(second);
  await flush();

  assert.deepEqual(overrideParams(page), [
    { width: 800, height: 600, deviceScaleFactor: 1, mobile: false },
    { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false },
  ]);

  first.viewport = { width: 640, height: 480, deviceScaleFactor: 1 };
  screen.viewportChanged(first);
  await flush();
  assert.equal(overrideParams(page).length, 2);

  screen.claimOwnership(first);
  await flush();
  assert.deepEqual(overrideParams(page)[2], {
    width: 640,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
  });

  screen.viewportChanged(first);
  await flush();
  assert.equal(overrideParams(page).length, 3);

  screen.claimOwnership(second);
  await flush();
  assert.deepEqual(overrideParams(page)[3], {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
});

test('reapplies the layout for a frame of another size and shows a frame within the tolerance', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  const viewer = fakeViewer();
  screen.addViewer(viewer);
  await flush();
  assert.equal(overrideParams(page).length, 1);

  page.emit('Page.screencastFrame', {
    data: 'too-large',
    metadata: { deviceWidth: 1026, deviceHeight: 770 },
    sessionId: 1,
  });
  await flush();

  assert.equal(viewer.frames.length, 0);
  assert.equal(overrideParams(page).length, 2);
  assert.deepEqual(overrideParams(page)[1], overrideParams(page)[0]);
  assert.deepEqual(callsTo(page, 'Page.screencastFrameAck')[0]?.params, { sessionId: 1 });

  page.emit('Page.screencastFrame', {
    data: 'within-tolerance',
    metadata: { deviceWidth: 1025, deviceHeight: 767 },
    sessionId: 2,
  });

  assert.equal(viewer.frames.length, 1);
  assert.deepEqual(viewer.frames[0], {
    image: Buffer.from('within-tolerance', 'base64'),
    width: 1025,
    height: 767,
  });
  assert.deepEqual(callsTo(page, 'Page.screencastFrameAck')[1]?.params, { sessionId: 2 });
  assert.equal(overrideParams(page).length, 2);
});

test('shows frames of a layout that stays lost after a second, and keeps reapplying it', async (t) => {
  // The hold is measured on the real clock, so this test runs on real timers.
  const { page, screen } = startScreen();
  t.after(() => screen.dispose());
  const viewer = fakeViewer();
  screen.addViewer(viewer);
  await flush();
  const wrongSize = (sessionId: number) =>
    page.emit('Page.screencastFrame', {
      data: `wrong-${sessionId}`,
      metadata: { deviceWidth: 1200, deviceHeight: 900 },
      sessionId,
    });
  const wrongFramesShown = () => viewer.frames.filter((frame) => frame.width === 1200).length;

  wrongSize(1);
  wrongSize(2);
  await flush();
  assert.equal(wrongFramesShown(), 0);
  assert.equal(overrideParams(page).length, 2);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  wrongSize(3);
  wrongSize(4);
  wrongSize(5);
  await flush();
  assert.equal(wrongFramesShown(), 3);
  assert.equal(overrideParams(page).length, 3);
});

test('removing the last viewer and releasing its screen stops the screencast', async () => {
  const registry = new ScreenRegistry(options, silentLog);
  const page = fakePage();
  const screen = registry.screenOf(page as unknown as ChromePage);
  const viewer = fakeViewer();
  screen.addViewer(viewer);
  await flush();
  const stopsWhileShown = callsTo(page, 'Page.stopScreencast').length;

  // As a viewer detaches: it leaves the screen, and the registry releases the screen at once.
  screen.removeViewer(viewer);
  registry.release(screen);
  await flush();

  assert.equal(callsTo(page, 'Page.stopScreencast').length, stopsWhileShown + 1);
  assert.equal(callsTo(page, 'Emulation.clearDeviceMetricsOverride').length, 1);
});

test('dispose stops the screencast, clears the override, and ends captures', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { page, screen } = startScreen();
  screen.addViewer(fakeViewer());
  await flush();
  await advance(t, LAYOUT_CAPTURE_MS);
  assert.equal(captureCount(page), 1);

  page.calls.length = 0;
  screen.dispose();
  await flush();

  assert.equal(screen.viewerCount, 0);
  assert.deepEqual(
    page.calls.map((call) => call.method),
    ['Page.stopScreencast', 'Emulation.clearDeviceMetricsOverride'],
  );

  await advance(t, 10 * STALLED_CAPTURE_MS);
  assert.equal(captureCount(page), 0);
});

test('the registry gives a page one screen while a viewer remains', async () => {
  const registry = new ScreenRegistry(options, silentLog);
  const page = fakePage('page-a');
  const chromePage = page as unknown as ChromePage;
  const screen = registry.screenOf(chromePage);

  assert.equal(registry.screenOf(chromePage), screen);
  assert.notEqual(registry.screenOf(fakePage('page-b') as unknown as ChromePage), screen);

  const viewer = fakeViewer();
  viewer.visible = false;
  screen.addViewer(viewer);
  await flush();
  registry.release(screen);

  assert.equal(registry.screenOf(chromePage), screen);
  assert.equal(screen.viewerCount, 1);
});

test('the registry releases a screen nobody views and creates a new one for the page', async () => {
  const registry = new ScreenRegistry(options, silentLog);
  const page = fakePage('page-a');
  const chromePage = page as unknown as ChromePage;
  const screen = registry.screenOf(chromePage);

  registry.release(screen);
  const next = registry.screenOf(chromePage);
  assert.notEqual(next, screen);

  const viewer = fakeViewer();
  viewer.visible = false;
  screen.addViewer(viewer);
  await flush();
  assert.deepEqual(page.calls, []);
});
