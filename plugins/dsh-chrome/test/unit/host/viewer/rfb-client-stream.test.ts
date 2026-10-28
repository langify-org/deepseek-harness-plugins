import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ClientMessage, ClientStream } from '../../../../src/host/viewer/rfb-client-stream.ts';

const VERSION_38 = Buffer.from('RFB 003.008\n', 'latin1');
const VERSION_33 = Buffer.from('RFB 003.003\n', 'latin1');

/** The handshake of RFB 3.8: the version, the security type (None) and ClientInit. */
const handshake38 = () => Buffer.concat([VERSION_38, Buffer.from([1, 1])]);

/** A message of the type, `length` bytes long, with the fields the test sets. */
function message(length: number, fields: Record<number, number>): Buffer {
  const bytes = Buffer.alloc(length);
  for (const [index, value] of Object.entries(fields)) bytes[Number(index)] = value;
  return bytes;
}

/** A stream past its handshake. */
function started(): ClientStream {
  const stream = new ClientStream();
  stream.push(handshake38());
  return stream;
}

const summary = (messages: ClientMessage[]) =>
  messages.map((item) => [item.kind, item.bytes.length] as const);

test('passes each step of the RFB 3.8 handshake as it comes: version, security type, ClientInit', () => {
  const stream = new ClientStream();
  // The server answers each step before the viewer sends the next: none may wait for another.
  assert.deepEqual(summary(stream.push(VERSION_38)), [['handshake', 12]]);
  assert.deepEqual(summary(stream.push(Buffer.from([1]))), [['handshake', 1]]);
  assert.deepEqual(summary(stream.push(Buffer.from([1]))), [['handshake', 1]]);
  assert.deepEqual(summary(stream.push(message(10, { 0: 3 }))), [['other', 10]]);
});

test('passes the RFB 3.3 handshake as the version and ClientInit, as the server picks the security type', () => {
  const stream = new ClientStream();
  assert.deepEqual(summary(stream.push(VERSION_33)), [['handshake', 12]]);
  const messages = stream.push(Buffer.from([1]));
  assert.deepEqual(summary(messages), [['handshake', 1]]);
  assert.deepEqual(summary(stream.push(message(8, { 0: 4 }))), [['key', 8]]);
});

test('waits for the rest of a version that arrives in pieces', () => {
  const stream = new ClientStream();
  assert.deepEqual(stream.push(VERSION_38.subarray(0, 5)), []);
  const messages = stream.push(VERSION_38.subarray(5));
  assert.deepEqual(summary(messages), [['handshake', 12]]);
  assert.deepEqual(messages[0]?.bytes, VERSION_38);
});

test('returns the handshake steps and the message after them that come in one chunk', () => {
  const stream = new ClientStream();
  const request = message(10, { 0: 3 });
  const messages = stream.push(Buffer.concat([handshake38(), request]));
  assert.deepEqual(summary(messages), [
    ['handshake', 12],
    ['handshake', 1],
    ['handshake', 1],
    ['other', 10],
  ]);
});

test('throws when the stream does not start with a VNC version', () => {
  assert.throws(() => new ClientStream().push(Buffer.from('GET / HTTP/1.1\r\n')), /VNC version/);
  assert.throws(() => new ClientStream().push(Buffer.from('RFB 3.8\n\0\0\0\0\0')), /VNC version/);
});

test('cuts a message that arrives split across chunks', () => {
  const stream = started();
  const key = message(8, { 0: 4, 1: 1, 7: 0x61 });
  assert.deepEqual(stream.push(key.subarray(0, 3)), []);
  assert.deepEqual(stream.push(key.subarray(3, 7)), []);
  const messages = stream.push(key.subarray(7));
  assert.deepEqual(summary(messages), [['key', 8]]);
  assert.deepEqual(messages[0]?.bytes, key);
});

test('cuts several messages that arrive in one chunk, and keeps a partial one for later', () => {
  const stream = started();
  const key = message(8, { 0: 4 });
  const update = message(10, { 0: 3 });
  const pointer = message(6, { 0: 5 });
  const all = Buffer.concat([key, update, pointer]);
  assert.deepEqual(summary(stream.push(all.subarray(0, 20))), [
    ['key', 8],
    ['other', 10],
  ]);
  assert.deepEqual(summary(stream.push(all.subarray(20))), [['other', 6]]);
});

test('cuts messages one byte at a time', () => {
  const stream = started();
  const bytes = Buffer.concat([message(20, { 0: 0 }), message(8, { 0: 4 })]);
  const kinds: string[] = [];
  for (const byte of bytes) {
    for (const item of stream.push(Buffer.from([byte]))) kinds.push(item.kind);
  }
  assert.deepEqual(kinds, ['other', 'key']);
});

test('cuts SetPixelFormat as 20 bytes', () => {
  assert.deepEqual(summary(started().push(message(20, { 0: 0 }))), [['other', 20]]);
});

test('cuts SetEncodings as 4 bytes and 4 per encoding', () => {
  const bytes = message(4 + 4 * 3, { 0: 2 });
  bytes.writeUInt16BE(3, 2);
  const stream = started();
  assert.deepEqual(stream.push(bytes.subarray(0, 6)), []);
  assert.deepEqual(summary(stream.push(bytes.subarray(6))), [['other', 16]]);
  const none = message(4, { 0: 2 });
  assert.deepEqual(summary(stream.push(none)), [['other', 4]]);
});

test('cuts FramebufferUpdateRequest as 10 bytes', () => {
  assert.deepEqual(summary(started().push(message(10, { 0: 3 }))), [['other', 10]]);
});

test('cuts a KeyEvent as 8 bytes of kind key', () => {
  assert.deepEqual(summary(started().push(message(8, { 0: 4 }))), [['key', 8]]);
});

test('cuts a PointerEvent as 6 bytes, or 7 when the second byte has the extended marker', () => {
  assert.deepEqual(summary(started().push(message(6, { 0: 5, 1: 0x01 }))), [['other', 6]]);
  assert.deepEqual(summary(started().push(message(7, { 0: 5, 1: 0x80 }))), [['other', 7]]);
  const stream = started();
  assert.deepEqual(stream.push(Buffer.from([5])), []);
  assert.deepEqual(summary(stream.push(message(6, { 0: 0x80 }))), [['other', 7]]);
});

test('cuts ClientCutText as 8 bytes and the text', () => {
  const bytes = message(8 + 5, { 0: 6 });
  bytes.writeInt32BE(5, 4);
  const stream = started();
  assert.deepEqual(stream.push(bytes.subarray(0, 10)), []);
  assert.deepEqual(summary(stream.push(bytes.subarray(10))), [['other', 13]]);
});

test('cuts ClientCutText with a negative (extended clipboard) length by its absolute value', () => {
  const bytes = message(8 + 7, { 0: 6 });
  bytes.writeInt32BE(-7, 4);
  assert.deepEqual(summary(started().push(bytes)), [['other', 15]]);
});

test('cuts EnableContinuousUpdates as 10 bytes', () => {
  assert.deepEqual(summary(started().push(message(10, { 0: 150 }))), [['other', 10]]);
});

test('cuts ClientFence as 9 bytes and its payload', () => {
  const bytes = message(9 + 4, { 0: 248, 8: 4 });
  const stream = started();
  assert.deepEqual(stream.push(bytes.subarray(0, 8)), []);
  assert.deepEqual(stream.push(bytes.subarray(8, 11)), []);
  assert.deepEqual(summary(stream.push(bytes.subarray(11))), [['other', 13]]);
  assert.deepEqual(summary(stream.push(message(9, { 0: 248 }))), [['other', 9]]);
});

test('cuts xvp as 4 bytes', () => {
  assert.deepEqual(summary(started().push(message(4, { 0: 250 }))), [['other', 4]]);
});

test('cuts SetDesktopSize as 8 bytes and 16 per screen, of kind set-desktop-size', () => {
  const bytes = message(8 + 16 * 2, { 0: 251, 6: 2 });
  const stream = started();
  assert.deepEqual(stream.push(bytes.subarray(0, 7)), []);
  assert.deepEqual(summary(stream.push(bytes.subarray(7))), [['set-desktop-size', 40]]);
});

test('cuts a QEMU extended key event as 12 bytes of kind key', () => {
  assert.deepEqual(summary(started().push(message(12, { 0: 255, 1: 0 }))), [['key', 12]]);
});

test('throws on a QEMU message other than the extended key event', () => {
  assert.throws(() => started().push(message(12, { 0: 255, 1: 1 })), /QEMU/);
});

test('throws on a message type a viewer does not send', () => {
  assert.throws(() => started().push(Buffer.from([99])), /type 99/);
});
