import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleOf } from '../../../../src/host/chrome/chrome-service.ts';

test('a scale the user set is the one Chrome takes, whatever the display', () => {
  assert.equal(scaleOf(2, 1), 2);
  assert.equal(scaleOf(1.5, undefined), 1.5);
});

test('auto is the pixel ratio of the display the user works on, so the screen has the pixels it shows', () => {
  assert.equal(scaleOf('auto', 1), 1);
  assert.equal(scaleOf('auto', 2), 2);
  assert.equal(scaleOf('auto', 1.5), 1.5);
});

test('auto rounds an odd pixel ratio to the quarter Chrome takes, within 1 to 4', () => {
  // Browser zoom and fractional scaling give ratios such as 1.1 or 1.33.
  assert.equal(scaleOf('auto', 1.1), 1);
  assert.equal(scaleOf('auto', 1.33), 1.25);
  assert.equal(scaleOf('auto', 0.5), 1);
  assert.equal(scaleOf('auto', 6), 4);
});

test('auto is 1 until a viewer says which display it is on', () => {
  assert.equal(scaleOf('auto', undefined), 1);
});
