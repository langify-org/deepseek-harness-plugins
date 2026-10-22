import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HelpRequests } from '../../../../src/host/chrome/help-requests.ts';
import type { ChromePage, PageEnding } from '../../../../src/host/chrome/pages/page.ts';

interface FakePage {
  readonly id: string;
  ending: PageEnding | undefined;
  readonly endListeners: Set<(ending: PageEnding) => void>;
  onEnded(listener: (ending: PageEnding) => void): () => void;
  end(ending: PageEnding): void;
}

function fakePage(id: string): FakePage {
  const page: FakePage = {
    id,
    ending: undefined,
    endListeners: new Set(),
    onEnded(listener) {
      page.endListeners.add(listener);
      return () => page.endListeners.delete(listener);
    },
    end(ending) {
      page.ending = ending;
      for (const listener of [...page.endListeners]) listener(ending);
    },
  };
  return page;
}

function asChromePage(page: FakePage): ChromePage {
  return page as unknown as ChromePage;
}

test('opens a request that current() shows and notifies change listeners', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const seen: string[] = [];
  requests.onChange((pageId) => seen.push(pageId));
  const promise = requests.ask(asChromePage(page), 'Please sign in', new AbortController().signal);

  const request = requests.current('page-1');
  assert.notEqual(request, undefined);
  assert.equal(request?.pageId, 'page-1');
  assert.equal(request?.message, 'Please sign in');
  assert.deepEqual(seen, ['page-1']);

  assert.equal(requests.answer('page-1', request?.id ?? '', 'done'), true);
  assert.equal(await promise, 'done');
});

test('answers with done or declined by request id and clears the request', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const signal = new AbortController().signal;

  const done = requests.ask(asChromePage(page), 'Sign in', signal);
  const doneRequest = requests.current('page-1');
  assert.equal(requests.answer('page-1', doneRequest?.id ?? '', 'done'), true);
  assert.equal(await done, 'done');
  assert.equal(requests.current('page-1'), undefined);

  const declined = requests.ask(asChromePage(page), 'Confirm the payment', signal);
  const declinedRequest = requests.current('page-1');
  assert.equal(requests.answer('page-1', declinedRequest?.id ?? '', 'declined'), true);
  assert.equal(await declined, 'declined');
  assert.equal(requests.current('page-1'), undefined);
});

test('ignores an answer whose request id is not the open one', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const promise = requests.ask(
    asChromePage(page),
    'Solve the CAPTCHA',
    new AbortController().signal,
  );

  const request = requests.current('page-1');
  assert.equal(requests.answer('page-1', 'some-other-request', 'done'), false);
  assert.equal(requests.current('page-1')?.id, request?.id);

  assert.equal(requests.answer('page-1', request?.id ?? '', 'done'), true);
  assert.equal(await promise, 'done');
});

test('rejects a second request on a page that already has one open', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const signal = new AbortController().signal;
  const first = requests.ask(asChromePage(page), 'First request', signal);

  await assert.rejects(
    requests.ask(asChromePage(page), 'Second request', signal),
    /this page already has an open request for help/,
  );
  const request = requests.current('page-1');
  assert.equal(request?.message, 'First request');

  assert.equal(requests.answer('page-1', request?.id ?? '', 'done'), true);
  assert.equal(await first, 'done');
});

test('rejects with the abort reason and clears the request when aborted', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const controller = new AbortController();
  const promise = requests.ask(
    asChromePage(page),
    'Unlock the password manager',
    controller.signal,
  );

  const reason = new Error('the agent stopped waiting');
  controller.abort(reason);
  await assert.rejects(promise, (error: unknown) => error === reason);
  assert.equal(requests.current('page-1'), undefined);
});

test('resolves page-ended when the page ends while the request is open', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const promise = requests.ask(
    asChromePage(page),
    'Unlock the vault',
    new AbortController().signal,
  );

  page.end('closed');
  assert.equal(await promise, 'page-ended');
  assert.equal(requests.current('page-1'), undefined);
});

test('resolves page-ended at once for a page that has already ended', async () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  page.end('released-by-user');

  assert.equal(
    await requests.ask(asChromePage(page), 'Help', new AbortController().signal),
    'page-ended',
  );
  assert.equal(requests.current('page-1'), undefined);
});

test('throws synchronously when the signal is already aborted', () => {
  const requests = new HelpRequests();
  const page = fakePage('page-1');
  const reason = new Error('already stopped');

  assert.throws(
    () => requests.ask(asChromePage(page), 'Help', AbortSignal.abort(reason)),
    (error: unknown) => error === reason,
  );
  assert.equal(requests.current('page-1'), undefined);
});
