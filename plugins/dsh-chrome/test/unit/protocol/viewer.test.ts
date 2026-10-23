import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeViewerEvent,
  decodeViewerRequest,
  parseViewerEvent,
  parseViewerRequest,
  screenPath,
} from '../../../src/protocol/viewer.ts';

test('parses every request a viewer sends, dropping fields the protocol does not define', () => {
  const requests = [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'viewport', width: 512.5, height: 900 },
    { type: 'claim-screen' },
    { type: 'open', url: 'example.com' },
    { type: 'open-window' },
    { type: 'restart-chrome' },
    { type: 'user-chrome' },
    { type: 'copy-profile', directory: 'Profile 2' },
    { type: 'answer-help', requestId: 'help-1', answer: 'done' },
    { type: 'answer-help', requestId: 'help-1', answer: 'declined' },
    { type: 'read-text', requestId: 'text-1' },
  ];
  for (const request of requests) {
    assert.deepEqual(parseViewerRequest({ ...request, extra: 'dropped' }), request);
    assert.deepEqual(decodeViewerRequest(JSON.stringify(request)), request);
  }
});

test('rejects requests that do not match the protocol', () => {
  const malformed: readonly unknown[] = [
    null,
    [],
    'watch',
    { type: 'watch' },
    { type: 'viewport', width: 0, height: 600 },
    { type: 'viewport', width: 800, height: -1 },
    { type: 'viewport', width: '800', height: 600 },
    { type: 'viewport', width: Number.POSITIVE_INFINITY, height: 600 },
    { type: 'open', url: 42 },
    { type: 'answer-help', requestId: 'help-1', answer: 'maybe' },
    { type: 'read-text' },
    { type: 'input', input: {} },
    { type: 'start-chrome' },
    { type: 'copy-profile' },
    { type: 'copy-profile', directory: 3 },
  ];
  for (const value of malformed) {
    assert.equal(parseViewerRequest(value), undefined, JSON.stringify(value));
  }
  assert.equal(decodeViewerRequest('{ not json'), undefined);
});

test('parses every event the host sends', () => {
  const events = [
    { type: 'chrome', status: { kind: 'stopped' } },
    { type: 'chrome', status: { kind: 'starting' } },
    {
      type: 'chrome',
      status: { kind: 'running', version: 'Chrome/154.0', settingsChanged: false },
    },
    {
      type: 'chrome',
      status: { kind: 'running', version: 'Chrome/154.0', settingsChanged: true },
    },
    { type: 'chrome', status: { kind: 'failed', message: 'Xvnc was not found' } },
    { type: 'screen', owner: true, region: null },
    { type: 'screen', owner: false, region: { x: 0, y: 1080, width: 1600, height: 900 } },
    { type: 'windows', open: true },
    { type: 'windows', open: false },
    { type: 'user-chrome', profiles: [], running: false },
    {
      type: 'user-chrome',
      profiles: [
        { directory: 'Default', name: 'Person 1', account: null },
        { directory: 'Profile 2', name: 'Work', account: 'me@example.com' },
      ],
      running: true,
    },
    { type: 'profile-copied', directory: 'Profile 2' },
    { type: 'help', request: null },
    {
      type: 'help',
      request: { id: 'help-1', message: 'Sign in', pageTitle: 'Bank', pageUrl: 'https://bank/' },
    },
    { type: 'page-text', requestId: 'text-1', title: 'Doc', url: 'https://doc/', text: '# Doc' },
    { type: 'failed', requestType: 'open', requestId: null, message: 'not a web address' },
    { type: 'failed', requestType: null, requestId: null, message: 'unreadable request' },
  ];
  for (const event of events) {
    assert.deepEqual(parseViewerEvent(event), event);
    assert.deepEqual(decodeViewerEvent(JSON.stringify(event)), event);
  }
});

test('rejects events that do not match the protocol', () => {
  const malformed: readonly unknown[] = [
    { type: 'chrome', status: { kind: 'paused' } },
    { type: 'chrome', status: { kind: 'running' } },
    { type: 'chrome', status: { kind: 'running', version: 'Chrome/154.0' } },
    { type: 'chrome', status: { kind: 'running', version: 'Chrome/154.0', settingsChanged: 1 } },
    { type: 'chrome', status: { kind: 'failed' } },
    { type: 'screen', owner: 'yes', region: null },
    { type: 'screen' },
    { type: 'screen', owner: true },
    { type: 'screen', owner: true, region: { x: -1, y: 0, width: 10, height: 10 } },
    { type: 'screen', owner: true, region: { x: 0, y: 0.5, width: 10, height: 10 } },
    { type: 'screen', owner: true, region: { x: 0, y: 0, width: 0, height: 10 } },
    { type: 'screen', owner: true, region: { x: 0, y: 0, width: 10 } },
    { type: 'windows' },
    { type: 'windows', open: 'yes' },
    { type: 'user-chrome', profiles: [], running: 'no' },
    { type: 'user-chrome', profiles: [{ directory: 'Default', name: 'P' }], running: false },
    {
      type: 'user-chrome',
      profiles: [{ directory: 'Default', name: 'P', account: 3 }],
      running: false,
    },
    { type: 'profile-copied' },
    { type: 'help', request: { id: 'help-1', message: 'Sign in' } },
    { type: 'page-text', requestId: 'text-1', title: 'Doc', url: 'https://doc/' },
    { type: 'failed', requestType: 'input', requestId: null, message: 'x' },
    { type: 'frame' },
  ];
  for (const value of malformed) {
    assert.equal(parseViewerEvent(value), undefined, JSON.stringify(value));
  }
});

test('names the screen socket of a session, escaping its id', () => {
  assert.equal(screenPath('session-1'), '/dsh-chrome/screen?session=session-1');
  assert.equal(screenPath('a b&c/d'), '/dsh-chrome/screen?session=a%20b%26c%2Fd');
});
