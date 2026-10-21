import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeFrame,
  decodeViewerEvent,
  decodeViewerRequest,
  encodeFrame,
  parseViewerRequest,
} from '../../../src/protocol/viewer.ts';

const viewport = { width: 1024, height: 768, deviceScaleFactor: 2 };
const page = {
  id: 'page-1',
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  browserLabel: 'Work Chrome',
  openedBy: 'agent',
};

function frameWithRawHeader(headerText: string): ArrayBuffer {
  const header = new TextEncoder().encode(headerText);
  const frame = new ArrayBuffer(4 + header.length);
  new DataView(frame).setUint32(0, header.length, true);
  new Uint8Array(frame, 4).set(header);
  return frame;
}

test('round-trips a frame header and its image bytes', () => {
  const header = { seq: 3, width: 1280, height: 720 };
  const image = new Uint8Array([0x00, 0x7f, 0x80, 0xff]);
  const frame = encodeFrame(header, image);
  assert.equal(frame.byteOffset, 0);
  assert.equal(frame.buffer.byteLength, frame.byteLength);
  const decoded = decodeFrame(frame.buffer as ArrayBuffer);
  assert.notEqual(decoded, undefined);
  assert.deepEqual(decoded?.header, header);
  assert.deepEqual(decoded?.image, image);
});

test('rejects a frame too short to hold a header length', () => {
  assert.equal(decodeFrame(new ArrayBuffer(0)), undefined);
  assert.equal(decodeFrame(new ArrayBuffer(3)), undefined);
});

test('rejects a frame whose announced header runs past the buffer', () => {
  const frame = new ArrayBuffer(8);
  new DataView(frame).setUint32(0, 100, true);
  assert.equal(decodeFrame(frame), undefined);
});

test('rejects a frame whose header is not JSON', () => {
  assert.equal(decodeFrame(frameWithRawHeader('not json')), undefined);
});

test('rejects a frame header whose width is not positive', () => {
  const frame = encodeFrame({ seq: 0, width: 0, height: 720 }, new Uint8Array());
  assert.equal(decodeFrame(frame.buffer as ArrayBuffer), undefined);
});

test('parses a watch request naming the viewer session', () => {
  assert.deepEqual(parseViewerRequest({ type: 'watch', sessionId: 'session-1', extra: 'drop' }), {
    type: 'watch',
    sessionId: 'session-1',
  });
});

test('parses an open request with its address and viewport', () => {
  assert.deepEqual(
    parseViewerRequest({ type: 'open', url: 'https://example.com/', viewport, extra: 'drop' }),
    { type: 'open', url: 'https://example.com/', viewport },
  );
});

test('parses visibility, help answers, and page text requests', () => {
  assert.deepEqual(parseViewerRequest({ type: 'visibility', visible: false }), {
    type: 'visibility',
    visible: false,
  });
  assert.deepEqual(parseViewerRequest({ type: 'answer-help', requestId: 'r1', answer: 'done' }), {
    type: 'answer-help',
    requestId: 'r1',
    answer: 'done',
  });
  assert.deepEqual(parseViewerRequest({ type: 'read-text', requestId: 'r2' }), {
    type: 'read-text',
    requestId: 'r2',
  });
  assert.equal(parseViewerRequest({ type: 'visibility', visible: 'yes' }), undefined);
  assert.equal(
    parseViewerRequest({ type: 'answer-help', requestId: 'r1', answer: 'maybe' }),
    undefined,
  );
  assert.equal(parseViewerRequest({ type: 'read-text' }), undefined);
});

test('parses an attach and a resize request with their viewports', () => {
  assert.deepEqual(parseViewerRequest({ type: 'attach', pageId: 'page-1', viewport }), {
    type: 'attach',
    pageId: 'page-1',
    viewport,
  });
  assert.deepEqual(
    parseViewerRequest({ type: 'resize', viewport: { ...viewport, extra: 'drop' } }),
    {
      type: 'resize',
      viewport,
    },
  );
});

test('parses navigation, history, reload, and close-page requests', () => {
  assert.deepEqual(parseViewerRequest({ type: 'navigate', url: 'https://example.com/next' }), {
    type: 'navigate',
    url: 'https://example.com/next',
  });
  assert.deepEqual(parseViewerRequest({ type: 'history', delta: -1 }), {
    type: 'history',
    delta: -1,
  });
  assert.deepEqual(parseViewerRequest({ type: 'history', delta: 1 }), {
    type: 'history',
    delta: 1,
  });
  assert.deepEqual(parseViewerRequest({ type: 'reload' }), { type: 'reload' });
  assert.deepEqual(parseViewerRequest({ type: 'close-page' }), { type: 'close-page' });
});

test('parses a frame-drawn acknowledgement with its sequence number', () => {
  assert.deepEqual(parseViewerRequest({ type: 'frame-drawn', seq: 9, extra: 'drop' }), {
    type: 'frame-drawn',
    seq: 9,
  });
});

test('parses mouse input with its position, button, and modifiers', () => {
  const input = {
    kind: 'mouse',
    action: 'down',
    x: 120,
    y: 240,
    button: 'left',
    buttons: 1,
    clickCount: 2,
    modifiers: 8,
  };
  assert.deepEqual(
    parseViewerRequest({ type: 'input', input: { ...input, extra: 'drop' }, extra: 'drop' }),
    {
      type: 'input',
      input,
    },
  );
});

test('parses wheel input with its deltas and modifiers', () => {
  const input = { kind: 'wheel', x: 10, y: 20, deltaX: -3, deltaY: 120, modifiers: 0 };
  assert.deepEqual(parseViewerRequest({ type: 'input', input }), { type: 'input', input });
});

test('parses key input with its text and modifiers', () => {
  const input = {
    kind: 'key',
    action: 'down',
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    text: 'a',
    modifiers: 2,
    repeat: false,
  };
  assert.deepEqual(parseViewerRequest({ type: 'input', input }), { type: 'input', input });
});

test('parses finished text input', () => {
  assert.deepEqual(parseViewerRequest({ type: 'input', input: { kind: 'text', text: '日本語' } }), {
    type: 'input',
    input: { kind: 'text', text: '日本語' },
  });
});

test('rejects a viewport whose dimensions are not positive numbers', () => {
  const invalidViewports: readonly unknown[] = [
    { width: 0, height: 600, deviceScaleFactor: 1 },
    { width: 800, height: -1, deviceScaleFactor: 1 },
    { width: 800, height: 600 },
    { width: '800', height: 600, deviceScaleFactor: 1 },
  ];
  for (const invalidViewport of invalidViewports) {
    const label = JSON.stringify(invalidViewport);
    assert.equal(
      parseViewerRequest({ type: 'resize', viewport: invalidViewport }),
      undefined,
      label,
    );
    assert.equal(
      parseViewerRequest({ type: 'attach', pageId: 'page-1', viewport: invalidViewport }),
      undefined,
      label,
    );
  }
});

test('rejects input whose kind the protocol does not define', () => {
  assert.equal(
    parseViewerRequest({ type: 'input', input: { kind: 'touch', x: 1, y: 2 } }),
    undefined,
  );
  assert.equal(parseViewerRequest({ type: 'input' }), undefined);
  assert.equal(
    parseViewerRequest({ type: 'input', input: { kind: 'mouse', action: 'move', x: 1, y: 2 } }),
    undefined,
  );
});

test('rejects a history request with a delta other than -1 or 1', () => {
  assert.equal(parseViewerRequest({ type: 'history', delta: 2 }), undefined);
  assert.equal(parseViewerRequest({ type: 'history', delta: 0 }), undefined);
  assert.equal(parseViewerRequest({ type: 'history', delta: '1' }), undefined);
});

test('rejects requests that do not match the protocol', () => {
  assert.equal(parseViewerRequest(null), undefined);
  assert.equal(parseViewerRequest([]), undefined);
  assert.equal(parseViewerRequest({ type: 'scroll' }), undefined);
  assert.equal(parseViewerRequest({ type: 'watch' }), undefined);
  assert.equal(parseViewerRequest({ type: 'open', url: 'https://example.com/' }), undefined);
  assert.equal(parseViewerRequest({ type: 'attach', pageId: 'page-1' }), undefined);
  assert.equal(parseViewerRequest({ type: 'navigate' }), undefined);
  assert.equal(parseViewerRequest({ type: 'frame-drawn', seq: '9' }), undefined);
});

test('decodes every kind of viewer request from JSON text', () => {
  const requests = [
    { type: 'watch', sessionId: 'session-1' },
    { type: 'open', url: 'https://example.com/', viewport },
    { type: 'attach', pageId: 'page-1', viewport },
    { type: 'visibility', visible: true },
    { type: 'answer-help', requestId: 'r1', answer: 'declined' },
    { type: 'read-text', requestId: 'r2' },
    { type: 'resize', viewport },
    {
      type: 'input',
      input: {
        kind: 'mouse',
        action: 'up',
        x: 120,
        y: 240,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        modifiers: 8,
      },
    },
    {
      type: 'input',
      input: { kind: 'wheel', x: 10, y: 20, deltaX: -3, deltaY: 120, modifiers: 0 },
    },
    {
      type: 'input',
      input: {
        kind: 'key',
        action: 'down',
        key: 'a',
        code: 'KeyA',
        keyCode: 65,
        text: 'a',
        modifiers: 0,
        repeat: false,
      },
    },
    { type: 'input', input: { kind: 'text', text: '日本語' } },
    { type: 'navigate', url: 'https://example.com/next' },
    { type: 'history', delta: -1 },
    { type: 'reload' },
    { type: 'close-page' },
    { type: 'frame-drawn', seq: 9 },
  ];
  for (const request of requests) {
    assert.deepEqual(decodeViewerRequest(JSON.stringify(request)), request);
  }
});

test('returns undefined for text that is not a viewer request', () => {
  assert.equal(decodeViewerRequest('not json'), undefined);
  assert.equal(decodeViewerRequest('null'), undefined);
  assert.equal(decodeViewerRequest('[]'), undefined);
  assert.equal(decodeViewerRequest(JSON.stringify({ type: 'open' })), undefined);
});

test('decodes attached and page events from JSON text', () => {
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'attached', page })), {
    type: 'attached',
    page,
  });
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'page', page })), {
    type: 'page',
    page,
  });
});

test('decodes a pages event from JSON text', () => {
  const pages = [page, { ...page, id: 'page-2', title: 'Second' }];
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'pages', pages })), {
    type: 'pages',
    pages,
  });
});

test('decodes ended and failed events from JSON text', () => {
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'ended', reason: 'closed' })), {
    type: 'ended',
    reason: 'closed',
  });
  const openFailed = {
    type: 'failed',
    requestType: 'open',
    requestId: null,
    message: 'no browser connected',
  };
  assert.deepEqual(decodeViewerEvent(JSON.stringify(openFailed)), openFailed);
  const textFailed = { type: 'failed', requestType: 'read-text', requestId: 'r2', message: 'gone' };
  assert.deepEqual(decodeViewerEvent(JSON.stringify(textFailed)), textFailed);
  const unreadable = { type: 'failed', requestType: null, requestId: null, message: 'unknown' };
  assert.deepEqual(decodeViewerEvent(JSON.stringify(unreadable)), unreadable);
});

test('rejects a failure naming a request type the protocol does not define', () => {
  const failed = { type: 'failed', requestType: 'open', requestId: null, message: 'm' };
  assert.equal(decodeViewerEvent(JSON.stringify({ ...failed, requestType: 'launch' })), undefined);
  assert.equal(
    decodeViewerEvent(JSON.stringify({ ...failed, requestType: 'toString' })),
    undefined,
  );
  assert.equal(decodeViewerEvent(JSON.stringify({ ...failed, requestId: 7 })), undefined);
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'failed', message: 'm' })), undefined);
});

test('decodes help requests and their withdrawal from JSON text', () => {
  const request = { id: 'r1', message: 'Please sign in.' };
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'help', request })), {
    type: 'help',
    request,
  });
  assert.deepEqual(decodeViewerEvent(JSON.stringify({ type: 'help', request: null })), {
    type: 'help',
    request: null,
  });
  assert.equal(
    decodeViewerEvent(JSON.stringify({ type: 'help', request: { id: 'r1' } })),
    undefined,
  );
});

test('decodes page text from JSON text', () => {
  const event = {
    type: 'page-text',
    requestId: 'r2',
    title: 'T',
    url: 'https://example.com/',
    text: '# T',
  };
  assert.deepEqual(decodeViewerEvent(JSON.stringify(event)), event);
  assert.equal(decodeViewerEvent(JSON.stringify({ ...event, text: 3 })), undefined);
});

test('rejects viewer events whose fields do not match the protocol', () => {
  assert.equal(
    decodeViewerEvent(JSON.stringify({ type: 'attached', page: { ...page, loading: 'no' } })),
    undefined,
  );
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'attached' })), undefined);
  assert.equal(
    decodeViewerEvent(JSON.stringify({ type: 'pages', pages: [page, { id: 'page-2' }] })),
    undefined,
  );
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'pages', pages: 'none' })), undefined);
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'ended', reason: 42 })), undefined);
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'failed' })), undefined);
  assert.equal(decodeViewerEvent(JSON.stringify({ type: 'hello' })), undefined);
  assert.equal(decodeViewerEvent('not json'), undefined);
  assert.equal(decodeViewerEvent('null'), undefined);
});
