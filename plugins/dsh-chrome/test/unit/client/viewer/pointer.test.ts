import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ClickCounter,
  mouseButton,
  TouchGesture,
  wheelPixels,
} from '../../../../src/client/viewer/pointer.ts';

test('maps pointer button numbers to CDP button names', () => {
  assert.equal(mouseButton(0), 'left');
  assert.equal(mouseButton(1), 'middle');
  assert.equal(mouseButton(2), 'right');
  assert.equal(mouseButton(3), 'none');
  assert.equal(mouseButton(4), 'none');
});

test('counts a second and a third press within 500 ms and 4 px', () => {
  const counter = new ClickCounter();
  assert.equal(counter.press(10, 10, 1000, 'left'), 1);
  assert.equal(counter.press(12, 13, 1300, 'left'), 2);
  assert.equal(counter.press(10, 10, 1700, 'left'), 3);
});

test('resets the count when the next press uses a different button', () => {
  const counter = new ClickCounter();
  counter.press(0, 0, 1000, 'left');
  assert.equal(counter.press(0, 0, 1100, 'right'), 1);
});

test('resets the count when more than 500 ms passes between presses', () => {
  const counter = new ClickCounter();
  counter.press(0, 0, 1000, 'left');
  assert.equal(counter.press(0, 0, 1500, 'left'), 2);
  assert.equal(counter.press(0, 0, 2001, 'left'), 1);
});

test('resets the count when the next press moves more than 4 px', () => {
  const counter = new ClickCounter();
  counter.press(0, 0, 1000, 'left');
  assert.equal(counter.press(4, 0, 1100, 'left'), 2);
  assert.equal(counter.press(4, 5, 1200, 'left'), 1);
});

test('reports the count of the last press as the current count', () => {
  const counter = new ClickCounter();
  assert.equal(counter.current, 1);
  counter.press(0, 0, 1000, 'left');
  assert.equal(counter.current, 1);
  counter.press(1, 1, 1100, 'left');
  assert.equal(counter.current, 2);
  counter.press(1, 1, 2000, 'left');
  assert.equal(counter.current, 1);
});

test('leaves pixel wheel deltas unchanged', () => {
  assert.deepEqual(wheelPixels({ deltaX: 3, deltaY: -4, deltaMode: 0 }, 800), {
    deltaX: 3,
    deltaY: -4,
  });
});

test('converts line wheel deltas to sixteen-pixel steps', () => {
  assert.deepEqual(wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 800), {
    deltaX: 32,
    deltaY: -48,
  });
});

test('converts page wheel deltas with the page height', () => {
  assert.deepEqual(wheelPixels({ deltaX: 1, deltaY: -1, deltaMode: 2 }, 800), {
    deltaX: 800,
    deltaY: -800,
  });
});

test('turns a short still touch into a tap at its start point', () => {
  const gesture = new TouchGesture();
  gesture.begin(120, 240, 1000);
  assert.equal(gesture.move(122, 241), undefined);
  assert.deepEqual(gesture.end(1300), { type: 'tap', x: 120, y: 240 });
});

test('starts scrolling at eight pixels of movement and sends deltas opposite the finger', () => {
  const gesture = new TouchGesture();
  gesture.begin(0, 0, 1000);
  assert.equal(gesture.move(7, 0), undefined);
  assert.deepEqual(gesture.move(8, 0), { type: 'scroll', x: 8, y: 0, deltaX: -8, deltaY: 0 });
  assert.deepEqual(gesture.move(8, 10), { type: 'scroll', x: 8, y: 10, deltaX: 0, deltaY: -10 });
});

test('does not report a tap after a touch has scrolled', () => {
  const gesture = new TouchGesture();
  gesture.begin(0, 0, 1000);
  gesture.move(0, 20);
  assert.equal(gesture.end(1100), undefined);
});

test('does not treat a touch held longer than 500 ms as a tap', () => {
  const gesture = new TouchGesture();
  gesture.begin(5, 6, 1000);
  assert.deepEqual(gesture.end(1500), { type: 'tap', x: 5, y: 6 });
  gesture.begin(5, 6, 2000);
  assert.equal(gesture.end(2501), undefined);
});

test('ignores movement and release that do not follow a begin', () => {
  const gesture = new TouchGesture();
  assert.equal(gesture.move(1, 2), undefined);
  assert.equal(gesture.end(3), undefined);
});
