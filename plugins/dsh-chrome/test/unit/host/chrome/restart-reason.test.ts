import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ChromeSettings,
  restartReasonFor,
} from '../../../../src/host/chrome/chrome-service.ts';

const settings: ChromeSettings = {
  executable: 'google-chrome-stable',
  deviceScaleFactor: 'auto',
  announceAutomation: false,
  webgl: 'gpu',
  shareNativeHosts: true,
};

/** A Chrome that started with the settings, at the scale given. */
function runningAt(deviceScaleFactor: number, started: ChromeSettings = settings) {
  return { settings: started, deviceScaleFactor };
}

test('a Chrome that runs as it would start now needs no restart', () => {
  assert.equal(restartReasonFor(runningAt(1), settings, 1, 1), undefined);
  assert.equal(restartReasonFor(runningAt(2), settings, 2, 1), undefined);
});

test('a setting other than the scale changed: the settings, whatever the display', () => {
  const changed = { ...settings, webgl: 'off' } as const;
  assert.equal(restartReasonFor(runningAt(1), changed, 1, 1), 'settings');
  assert.equal(restartReasonFor(runningAt(1), changed, 2, 1), 'settings');
  assert.equal(restartReasonFor(runningAt(1), changed, undefined, 1), 'settings');
});

test('an auto scale for a viewer on a display of another pixel ratio: the display', () => {
  assert.equal(restartReasonFor(runningAt(1), settings, 2, 1), 'display');
  assert.equal(restartReasonFor(runningAt(2), settings, 1, 2), 'display');
  // A ratio that rounds to the scale Chrome draws at is the same display.
  assert.equal(restartReasonFor(runningAt(1), settings, 1.1, 1), undefined);
});

test('a scale set as a number Chrome already draws at needs no restart; another one, the settings', () => {
  const two = { ...settings, deviceScaleFactor: 2 };
  // Chrome started with auto on a display of ratio 2: 2 is what it draws at.
  assert.equal(restartReasonFor(runningAt(2), two, 1, 1), undefined);
  assert.equal(restartReasonFor(runningAt(1), two, 1, 1), 'settings');
  // Back to auto from a number: the setting changed, for a display it changes the scale for.
  assert.equal(restartReasonFor(runningAt(2, two), settings, 1, 1), 'settings');
  assert.equal(restartReasonFor(runningAt(2, two), settings, 2, 1), undefined);
});

test('a viewer whose display is not known yet is told of no display, only of settings', () => {
  // Another viewer's display would start Chrome otherwise: this viewer is not told so.
  assert.equal(restartReasonFor(runningAt(2), settings, undefined, 1), undefined);
  // A changed scale setting counts as the ratio Chrome would start at takes it.
  const two = { ...settings, deviceScaleFactor: 2 };
  assert.equal(restartReasonFor(runningAt(2, two), settings, undefined, 1), 'settings');
  assert.equal(restartReasonFor(runningAt(2, two), settings, undefined, 2), undefined);
});
