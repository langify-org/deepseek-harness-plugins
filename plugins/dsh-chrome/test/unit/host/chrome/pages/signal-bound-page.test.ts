import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpConnection } from '../../../../../src/host/chrome/cdp/cdp-connection.ts';
import { PageRegistry } from '../../../../../src/host/chrome/pages/page-registry.ts';
import { boundToSignal } from '../../../../../src/host/chrome/pages/signal-bound-page.ts';
import { silentLog } from '../../../../../src/host/platform/log.ts';
import { FakeBrowser } from '../../../../support/fake-browser.ts';

async function onePage() {
  const browser = new FakeBrowser();
  const pages = new PageRegistry();
  await pages.track(new CdpConnection(browser, silentLog));
  pages.claim('T1', 'session-a', 'agent');
  browser.attachPage({ targetId: 'T1', url: 'https://a/', title: 'A' }, 'S1');
  return { browser, page: await pages.whenAdopted('T1') };
}

test('shows the page as it is, and passes its listeners and actions through', async () => {
  const { browser, page } = await onePage();
  const bound = boundToSignal(page, new AbortController().signal);
  assert.deepEqual(
    [bound.id, bound.targetId, bound.sessionId, bound.openedBy, bound.url, bound.title],
    [page.id, 'T1', 'session-a', 'agent', 'https://a/', 'A'],
  );
  let changes = 0;
  bound.onChanged(() => changes++);
  browser.emit('Target.targetInfoChanged', {
    targetInfo: { targetId: 'T1', type: 'page', url: 'https://b/', title: 'B', attached: true },
  });
  assert.deepEqual([bound.url, changes], ['https://b/', 1]);
  await bound.close();
  assert.equal(browser.commands('Target.closeTarget').length, 1);
});

test("ends the page's commands when the signal aborts, as well as by their own signals", async () => {
  const { browser, page } = await onePage();
  browser.ignore('Page.reload');
  const call = new AbortController();
  const bound = boundToSignal(page, call.signal);
  const own = new AbortController();
  const reloading = bound.send('Page.reload', undefined, { signal: own.signal });
  const other = bound.send('Page.reload');
  own.abort(new Error('its own'));
  await assert.rejects(reloading, /its own/);
  call.abort(new Error('the call stopped'));
  await assert.rejects(other, /the call stopped/);
  // The page itself goes on.
  browser.answer('Page.reload', () => ({}));
  await page.send('Page.reload');
});
