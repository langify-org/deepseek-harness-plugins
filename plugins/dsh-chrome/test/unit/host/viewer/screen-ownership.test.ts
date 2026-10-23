import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentLog } from '../../../../src/host/platform/log.ts';
import {
  ScreenOwnership,
  type ScreenSize,
  type ScreenViewer,
  type ViewerArea,
} from '../../../../src/host/viewer/screen-ownership.ts';

class FakeViewer implements ScreenViewer {
  area: ViewerArea | undefined;
  owner: boolean | undefined;

  constructor(area?: ViewerArea) {
    this.area = area;
  }

  ownerChanged(owner: boolean): void {
    this.owner = owner;
  }
}

function layout(): { readonly sizes: ScreenSize[]; readonly layout: ScreenOwnership } {
  const sizes: ScreenSize[] = [];
  return {
    sizes,
    layout: new ScreenOwnership(
      async (size) => {
        sizes.push(size);
      },
      () => 2,
      silentLog,
    ),
  };
}

test('lays the screen out for the first viewer, in device pixels, once it gives its area', () => {
  const { sizes, layout: screen } = layout();
  const viewer = new FakeViewer();
  screen.add(viewer);
  assert.equal(viewer.owner, true);
  assert.deepEqual(sizes, []);
  viewer.area = { width: 600.5, height: 300 };
  screen.areaChanged(viewer);
  assert.deepEqual(sizes, [{ width: 1201, height: 600 }]);
  // The same size is not asked for again.
  screen.areaChanged(viewer);
  assert.equal(sizes.length, 1);
});

test("gives a viewer narrower than Chrome's narrowest window a screen that wide, in proportion", () => {
  const { sizes, layout: screen } = layout();
  screen.add(new FakeViewer({ width: 400, height: 800 }));
  // 500 CSS pixels at twice the pixels, and the height in the same proportion.
  assert.deepEqual(sizes, [{ width: 1000, height: 2000 }]);
});

test('follows the viewer the user works in, and only its area', () => {
  const { sizes, layout: screen } = layout();
  const desktop = new FakeViewer({ width: 600, height: 800 });
  const tablet = new FakeViewer({ width: 700, height: 900 });
  screen.add(desktop);
  screen.add(tablet);
  assert.deepEqual([desktop.owner, tablet.owner], [true, false]);
  tablet.area = { width: 720, height: 900 };
  screen.areaChanged(tablet);
  assert.deepEqual(sizes, [{ width: 1200, height: 1600 }]);

  screen.claim(tablet);
  assert.deepEqual([desktop.owner, tablet.owner], [false, true]);
  assert.deepEqual(sizes.at(-1), { width: 1440, height: 1800 });
});

test('hands the screen back to the viewer that had it before, when its owner leaves', () => {
  const { sizes, layout: screen } = layout();
  const first = new FakeViewer({ width: 600, height: 100 });
  const second = new FakeViewer({ width: 700, height: 200 });
  const third = new FakeViewer({ width: 800, height: 300 });
  for (const viewer of [first, second, third]) screen.add(viewer);
  screen.claim(third);
  screen.claim(second);
  screen.remove(second);
  assert.equal(screen.owner, third);
  assert.deepEqual(sizes.at(-1), { width: 1600, height: 600 });
  screen.remove(third);
  assert.equal(screen.owner, first);
  screen.remove(first);
  assert.equal(screen.owner, undefined);
});

test('tries a size again after the screen failed to take it', async () => {
  let failures = 1;
  const asked: ScreenSize[] = [];
  const screen = new ScreenOwnership(
    async (size) => {
      asked.push(size);
      if (failures-- > 0) throw new Error('Xvnc did not answer');
    },
    () => 1,
    silentLog,
  );
  const viewer = new FakeViewer({ width: 500, height: 400 });
  screen.add(viewer);
  await new Promise((resolve) => setImmediate(resolve));
  screen.areaChanged(viewer);
  assert.equal(asked.length, 2);
});

test('is empty until a viewer is added, and again when the last one leaves', () => {
  const { layout: screen } = layout();
  assert.equal(screen.empty, true);
  const viewer = new FakeViewer();
  screen.add(viewer);
  assert.equal(screen.empty, false);
  screen.remove(viewer);
  assert.equal(screen.empty, true);
});

test('reads the device scale factor each time it lays the screen out', () => {
  const sizes: ScreenSize[] = [];
  let factor = 1;
  const screen = new ScreenOwnership(
    async (size) => {
      sizes.push(size);
    },
    () => factor,
    silentLog,
  );
  const viewer = new FakeViewer({ width: 600, height: 400 });
  screen.add(viewer);
  assert.deepEqual(sizes.at(-1), { width: 600, height: 400 });
  factor = 2;
  viewer.area = { width: 700, height: 400 };
  screen.areaChanged(viewer);
  assert.deepEqual(sizes.at(-1), { width: 1400, height: 800 });
});
