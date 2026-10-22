import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HelpRequests } from '../../../../src/host/chrome/help-requests.ts';
import type { ChromePage, PageEnding } from '../../../../src/host/chrome/pages/page.ts';

interface FakePage {
  readonly page: ChromePage;
  end(ending: PageEnding): void;
}

function fakePage(id: string): FakePage {
  const listeners = new Set<(ending: PageEnding) => void>();
  let ending: PageEnding | undefined;
  const page = {
    id,
    get ending() {
      return ending;
    },
    onEnded(listener: (ending: PageEnding) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as ChromePage;
  return {
    page,
    end(reason) {
      ending = reason;
      for (const listener of [...listeners]) listener(reason);
    },
  };
}

const never = () => new AbortController().signal;

test("shows an open request to the asking session only, and settles it with the user's answer", async () => {
  const requests = new HelpRequests();
  const { page } = fakePage('page-1');
  let changes = 0;
  requests.onChange(() => changes++);
  const asked = requests.ask(page, 'session-a', 'Please sign in', never());

  const request = requests.ofSession('session-a');
  assert.deepEqual(
    { pageId: request?.pageId, sessionId: request?.sessionId, message: request?.message },
    { pageId: 'page-1', sessionId: 'session-a', message: 'Please sign in' },
  );
  assert.equal(requests.ofSession('session-b'), undefined);
  assert.equal(changes, 1);

  assert.equal(requests.answer(request?.id ?? '', 'declined'), true);
  assert.equal(await asked, 'declined');
  assert.equal(requests.ofSession('session-a'), undefined);
  assert.equal(changes, 2);
});

test('ignores an answer to a request that is not open', async () => {
  const requests = new HelpRequests();
  const asked = requests.ask(fakePage('page-1').page, 'session-a', 'Sign in', never());
  assert.equal(requests.answer('another-request', 'done'), false);
  const request = requests.ofSession('session-a');
  assert.equal(requests.answer(request?.id ?? '', 'done'), true);
  assert.equal(await asked, 'done');
  assert.equal(requests.answer(request?.id ?? '', 'done'), false);
});

test("shows a session's latest request when it has several, on different pages", async () => {
  const requests = new HelpRequests();
  const first = requests.ask(fakePage('page-1').page, 'session-a', 'First', never());
  const second = requests.ask(fakePage('page-2').page, 'session-a', 'Second', never());
  assert.equal(requests.ofSession('session-a')?.message, 'Second');
  requests.answer(requests.ofSession('session-a')?.id ?? '', 'done');
  assert.equal(requests.ofSession('session-a')?.message, 'First');
  requests.answer(requests.ofSession('session-a')?.id ?? '', 'done');
  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
});

test('refuses a second request on a page that has one open', async () => {
  const requests = new HelpRequests();
  const { page } = fakePage('page-1');
  const asked = requests.ask(page, 'session-a', 'First', never());
  await assert.rejects(requests.ask(page, 'session-b', 'Second', never()), /already has an open/);
  requests.answer(requests.ofSession('session-a')?.id ?? '', 'done');
  await asked;
});

test('ends a request when the agent stops waiting, with the reason it stopped', async () => {
  const requests = new HelpRequests();
  const controller = new AbortController();
  const asked = requests.ask(fakePage('page-1').page, 'session-a', 'Sign in', controller.signal);
  controller.abort(new Error('the turn was stopped'));
  await assert.rejects(asked, /the turn was stopped/);
  assert.equal(requests.ofSession('session-a'), undefined);
  assert.throws(() => requests.ask(fakePage('page-2').page, 'session-a', 'x', controller.signal));
});

test('ends a request as page-ended when its page ends, or has ended', async () => {
  const requests = new HelpRequests();
  const open = fakePage('page-1');
  const asked = requests.ask(open.page, 'session-a', 'Sign in', never());
  open.end('closed');
  assert.equal(await asked, 'page-ended');
  assert.equal(requests.ofSession('session-a'), undefined);

  const ended = fakePage('page-2');
  ended.end('chrome-stopped');
  assert.equal(await requests.ask(ended.page, 'session-a', 'Sign in', never()), 'page-ended');
});
