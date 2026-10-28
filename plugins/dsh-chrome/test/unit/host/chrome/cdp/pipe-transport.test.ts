import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { PipeTransport } from '../../../../../src/host/chrome/cdp/pipe-transport.ts';

test("ends each message it sends with a NUL byte, as Chrome's pipe expects", () => {
  const toChrome = new PassThrough();
  const written: string[] = [];
  toChrome.setEncoding('utf8').on('data', (chunk: string) => written.push(chunk));
  const transport = new PipeTransport(toChrome, new PassThrough());
  transport.send('{"id":1}');
  transport.send('{"id":2}');
  assert.equal(written.join(''), '{"id":1}\0{"id":2}\0');
});

test('reads messages however the pipe splits them, multibyte characters included', async () => {
  const fromChrome = new PassThrough();
  const transport = new PipeTransport(new PassThrough(), fromChrome);
  const messages: string[] = [];
  transport.onMessage((message) => messages.push(message));
  const bytes = Buffer.from('{"title":"日本"}\0{"id":2}\0{"id":', 'utf8');
  // Split inside the first character of 日.
  fromChrome.write(bytes.subarray(0, 11));
  fromChrome.write(bytes.subarray(11));
  fromChrome.write('3}\0');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages, ['{"title":"日本"}', '{"id":2}', '{"id":3}']);
});

test('reports once that Chrome closed its end, and sends nothing after', async () => {
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  const transport = new PipeTransport(toChrome, fromChrome);
  const reasons: string[] = [];
  transport.onClose((reason) => reasons.push(reason.message));
  fromChrome.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  transport.close();
  transport.send('{"id":1}');
  assert.deepEqual(reasons, ['Chrome closed its debugging pipe']);
  transport.onClose((reason) => reasons.push(`late: ${reason.message}`));
  assert.equal(reasons[1], 'late: Chrome closed its debugging pipe');
});
