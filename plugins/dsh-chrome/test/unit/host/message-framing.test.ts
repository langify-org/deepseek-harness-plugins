import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeFrame,
  FrameDecoder,
  FrameTooLargeError,
} from '../../../src/host/runtime/message-framing.ts';

test('writes a four-byte little-endian body length and the UTF-8 JSON body', () => {
  const message = { type: 'hello', text: '日本語' };
  const frame = encodeFrame(message);
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  assert.equal(frame.length, 4 + body.length);
  assert.equal(frame.readUInt32LE(0), body.length);
  assert.deepEqual(frame.subarray(4), body);
  assert.equal(frame.subarray(4).toString('utf8'), '{"type":"hello","text":"日本語"}');
});

test('reassembles a frame split at every byte boundary', () => {
  const message = { type: 'request', id: 1, method: 'page.list', params: {} };
  const frame = encodeFrame(message);
  for (let split = 0; split <= frame.length; split += 1) {
    const decoder = new FrameDecoder(1024);
    const messages: unknown[] = [];
    if (split > 0) messages.push(...decoder.push(frame.subarray(0, split)));
    if (split < frame.length) messages.push(...decoder.push(frame.subarray(split)));
    assert.deepEqual(messages, [message], `split at byte ${split}`);
  }
});

test('returns every message completed by one chunk', () => {
  const first = { type: 'first' };
  const second = { type: 'second' };
  const decoder = new FrameDecoder(1024);
  const messages = decoder.push(Buffer.concat([encodeFrame(first), encodeFrame(second)]));
  assert.deepEqual(messages, [first, second]);
});

test('keeps an incomplete frame buffered until its remaining bytes arrive', () => {
  const first = { type: 'first' };
  const second = { type: 'second' };
  const firstFrame = encodeFrame(first);
  const decoder = new FrameDecoder(1024);
  assert.deepEqual(decoder.push(firstFrame.subarray(0, firstFrame.length - 1)), []);
  assert.deepEqual(
    decoder.push(Buffer.concat([firstFrame.subarray(firstFrame.length - 1), encodeFrame(second)])),
    [first, second],
  );
});

test('accepts a frame whose body is exactly the size limit', () => {
  const message = 1;
  const frame = encodeFrame(message);
  const decoder = new FrameDecoder(frame.length - 4);
  assert.deepEqual(decoder.push(frame), [message]);
});

test('throws FrameTooLargeError when a frame announces more than the limit', () => {
  const decoder = new FrameDecoder(8);
  const frame = encodeFrame({ over: 'the limit' });
  const announced = frame.readUInt32LE(0);
  assert.throws(
    () => decoder.push(frame.subarray(0, 4)),
    (error: unknown) =>
      error instanceof FrameTooLargeError &&
      error.message === `a frame of ${announced} bytes exceeds the 8-byte limit`,
  );
});

test('throws SyntaxError when a frame body is not JSON', () => {
  const body = Buffer.from('not json', 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  const decoder = new FrameDecoder(1024);
  assert.throws(() => decoder.push(Buffer.concat([header, body])), SyntaxError);
});

test('reassembles a large frame from many chunks, followed by a small one', () => {
  const large = { data: 'x'.repeat(1_000_000) };
  const bytes = Buffer.concat([encodeFrame(large), encodeFrame({ after: true })]);
  const decoder = new FrameDecoder(2_000_000);
  const messages: unknown[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    messages.push(...decoder.push(bytes.subarray(offset, offset + 4096)));
  }
  assert.deepEqual(messages, [large, { after: true }]);
});
