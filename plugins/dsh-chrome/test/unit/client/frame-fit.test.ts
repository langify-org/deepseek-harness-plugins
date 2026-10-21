import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitFrame, toPagePoint } from '../../../src/client/viewer/frame-fit.ts';

test('fills the surface when the frame and the surface have the same aspect ratio', () => {
  assert.deepEqual(fitFrame({ width: 800, height: 600 }, { width: 1600, height: 1200 }), {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
});

test('letterboxes a wider frame with equal space above and below', () => {
  assert.deepEqual(fitFrame({ width: 800, height: 600 }, { width: 1600, height: 800 }), {
    x: 0,
    y: 100,
    width: 800,
    height: 400,
  });
});

test('pillarboxes a taller frame with equal space left and right', () => {
  assert.deepEqual(fitFrame({ width: 800, height: 600 }, { width: 400, height: 800 }), {
    x: 250,
    y: 0,
    width: 300,
    height: 600,
  });
});

test('maps the corners and the centre of the drawn frame to page pixels', () => {
  const placement = { x: 0, y: 100, width: 800, height: 400 };
  const frame = { width: 1000, height: 500 };
  assert.deepEqual(toPagePoint(placement, frame, 0, 100), { x: 0, y: 0 });
  assert.deepEqual(toPagePoint(placement, frame, 800, 500), { x: 1000, y: 500 });
  assert.deepEqual(toPagePoint(placement, frame, 400, 300), { x: 500, y: 250 });
});

test('returns undefined for a point in the letterbox or beside the frame', () => {
  const letterboxed = { x: 0, y: 100, width: 800, height: 400 };
  const frame = { width: 1000, height: 500 };
  assert.equal(toPagePoint(letterboxed, frame, 400, 50), undefined);
  assert.equal(toPagePoint(letterboxed, frame, 400, 550), undefined);

  const pillarboxed = { x: 250, y: 0, width: 300, height: 600 };
  const tallerFrame = { width: 500, height: 1000 };
  assert.equal(toPagePoint(pillarboxed, tallerFrame, 100, 300), undefined);
  assert.equal(toPagePoint(pillarboxed, tallerFrame, 700, 300), undefined);
});
