import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpConnection, CdpError } from '../../../../../src/host/chrome/cdp/cdp-connection.ts';
import { isCdpCommand } from '../../../../../src/host/chrome/cdp/cdp-methods.ts';
import { silentLog } from '../../../../../src/host/platform/log.ts';
import { FakeBrowser, settle } from '../../../../support/fake-browser.ts';

function connect(): { readonly browser: FakeBrowser; readonly connection: CdpConnection } {
  const browser = new FakeBrowser();
  return { browser, connection: new CdpConnection(browser, silentLog) };
}

const failure = (kind: CdpError['failure']) => (error: unknown) =>
  error instanceof CdpError && error.failure === kind;

test("sends a command for the browser or a page's session, and resolves with Chrome's result", async () => {
  const { browser, connection } = connect();
  browser.answer('Browser.getVersion', () => ({ product: 'Chrome/154' }));
  browser.answer('Runtime.evaluate', ({ params }) => ({ result: { value: params['expression'] } }));

  assert.equal((await connection.send('Browser.getVersion')).product, 'Chrome/154');
  const { result } = await connection.send(
    'Runtime.evaluate',
    { expression: '1 + 1' },
    { sessionId: 'session-7' },
  );
  assert.equal(result.value, '1 + 1');
  assert.deepEqual(
    browser.sent.map(({ method, sessionId }) => ({ method, sessionId })),
    [
      { method: 'Browser.getVersion', sessionId: undefined },
      { method: 'Runtime.evaluate', sessionId: 'session-7' },
    ],
  );
});

test("rejects with Chrome's error, keeping its detail", async () => {
  const { browser, connection } = connect();
  browser.answer('Page.navigate', () => ({ error: 'Cannot navigate to invalid URL' }));
  await assert.rejects(connection.send('Page.navigate', { url: 'x' }), (error: unknown) => {
    return failure('protocol')(error) && /invalid URL/.test(String(error));
  });
});

test('refuses commands outside the ones dsh-chrome uses, without sending them', async () => {
  const { browser, connection } = connect();
  assert.equal(isCdpCommand('Network.getAllCookies'), false);
  const send = connection.send as unknown as (method: string) => Promise<unknown>;
  await assert.rejects(send.call(connection, 'Network.getAllCookies'), failure('refused'));
  assert.deepEqual(browser.sent, []);
});

test('gives up on a command that takes too long, and drops its late answer', async () => {
  const { browser, connection } = connect();
  browser.ignore('Page.reload');
  await assert.rejects(
    connection.send('Page.reload', undefined, { timeoutMs: 20 }),
    failure('timeout'),
  );
});

test('ends a command when its signal aborts, and sends none whose signal already has', async () => {
  const { browser, connection } = connect();
  browser.ignore('Page.reload');
  const controller = new AbortController();
  const reloading = connection.send('Page.reload', undefined, { signal: controller.signal });
  controller.abort(new Error('stopped'));
  await assert.rejects(reloading, /stopped/);
  await assert.rejects(
    connection.send('Page.reload', undefined, { signal: controller.signal }),
    /stopped/,
  );
  assert.equal(browser.commands('Page.reload').length, 1);
});

test('rejects what waits when Chrome closes the connection, and what is sent after', async () => {
  const { browser, connection } = connect();
  browser.ignore('Page.reload');
  const reasons: string[] = [];
  connection.onClose((reason) => reasons.push(reason.message));
  const reloading = connection.send('Page.reload');
  browser.exit();
  await assert.rejects(reloading, failure('closed'));
  await assert.rejects(connection.send('Page.reload'), failure('closed'));
  assert.equal(connection.closed, true);
  assert.deepEqual(reasons, ['Chrome exited']);
  // A listener added after the close hears of it at once.
  let late = false;
  connection.onClose(() => {
    late = true;
  });
  assert.equal(late, true);
});

test('hands events to their listeners with the session they came from, until unsubscribed', async () => {
  const { browser, connection } = connect();
  const heard: { url: string; sessionId: string | undefined }[] = [];
  const stop = connection.on('Page.frameNavigated', ({ frame }, sessionId) =>
    heard.push({ url: frame.url, sessionId }),
  );
  browser.emit('Page.frameNavigated', { frame: { url: 'https://a/' } }, 'session-1');
  stop();
  browser.emit('Page.frameNavigated', { frame: { url: 'https://b/' } }, 'session-1');
  await settle();
  assert.deepEqual(heard, [{ url: 'https://a/', sessionId: 'session-1' }]);
});

test('keeps telling the other listeners when one throws', async () => {
  const warnings: string[] = [];
  const browser = new FakeBrowser();
  const connection = new CdpConnection(browser, {
    info: () => {},
    warn: (message) => warnings.push(message),
  });
  let heard = 0;
  connection.on('Page.loadEventFired', () => {
    throw new Error('broken listener');
  });
  connection.on('Page.loadEventFired', () => heard++);
  browser.emit('Page.loadEventFired', { timestamp: 1 });
  assert.equal(heard, 1);
  assert.match(warnings[0] ?? '', /broken listener/);
});
