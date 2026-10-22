import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChromePage, PageDialog } from '../../../../src/host/chrome/pages/page.ts';
import {
  answerDialog,
  describeDialog,
  untilDialog,
} from '../../../../src/host/page-operations/dialogs.ts';

interface FakePage {
  dialog: PageDialog | undefined;
  readonly sent: { readonly method: string; readonly params: unknown }[];
  /** Opens or closes a dialog, as the registry does when Chrome reports one. */
  showDialog(dialog: PageDialog | undefined): void;
}

function fakePage(): FakePage & { readonly page: ChromePage } {
  const listeners = new Set<() => void>();
  const fake = {
    dialog: undefined as PageDialog | undefined,
    sent: [] as { method: string; params: unknown }[],
    showDialog(dialog: PageDialog | undefined) {
      fake.dialog = dialog;
      for (const listener of [...listeners]) listener();
    },
  };
  const page = {
    get dialog() {
      return fake.dialog;
    },
    onChanged(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // As a connected browser does, a command whose signal aborted is never sent.
    send(method: string, params: unknown, options?: { signal?: AbortSignal }) {
      if (options?.signal?.aborted) return Promise.reject(options.signal.reason);
      fake.sent.push({ method, params });
      return Promise.resolve({});
    },
  } as unknown as ChromePage;
  return Object.assign(fake, { page });
}

const confirmation: PageDialog = {
  kind: 'confirm',
  message: 'Delete it?',
  defaultPrompt: '',
  url: 'https://example.com/',
};
/** A dialog of the kind, with nothing else to say. */
const dialogOf = (kind: PageDialog['kind'], message = '', defaultPrompt = ''): PageDialog => ({
  kind,
  message,
  defaultPrompt,
  url: 'https://example.com/',
});

test('ends with the operation when the page opens no dialog', async () => {
  const { page } = fakePage();
  assert.deepEqual(await untilDialog(page, async () => 'clicked'), { completed: 'clicked' });
});

test('passes on the failure of an operation no dialog interrupted', async () => {
  const { page } = fakePage();
  await assert.rejects(
    untilDialog(page, () => Promise.reject(new Error('gone'))),
    /gone/,
  );
});

test('ends as soon as the page opens a dialog, and drops what the operation does later', async () => {
  const fake = fakePage();
  let finish: (error: Error) => void = () => {};
  const operation = new Promise<string>((_resolve, reject) => {
    finish = reject;
  });
  const outcome = untilDialog(fake.page, () => operation);
  fake.showDialog(confirmation);
  assert.deepEqual(await outcome, { dialog: confirmation });
  // The command the dialog held up fails once it is answered; nothing hears of it.
  finish(new Error('cdp.send got no answer'));
  await new Promise((resolve) => setImmediate(resolve));
});

test('ends before the operation starts when the page already shows a dialog', async () => {
  const fake = fakePage();
  fake.showDialog(confirmation);
  let started = false;
  const outcome = await untilDialog(fake.page, async () => {
    started = true;
  });
  assert.deepEqual(outcome, { dialog: confirmation });
  assert.equal(started, false);
});

test('does not do the rest of an operation a dialog interrupted', async () => {
  const fake = fakePage();
  let release: () => void = () => {};
  const firstPressAnswered = new Promise<void>((resolve) => {
    release = resolve;
  });
  const outcome = untilDialog(fake.page, async (page) => {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    await firstPressAnswered;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 1,
      y: 1,
      clickCount: 2,
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  fake.showDialog(confirmation);
  assert.deepEqual(await outcome, { dialog: confirmation });
  // The dialog is answered and the first press with it; the second is never sent.
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    fake.sent.map(({ params }) => (params as { clickCount?: number }).clickCount ?? 1),
    [1],
  );
});

test("answers the page's dialog, with a prompt's text when given", async () => {
  const fake = fakePage();
  fake.showDialog(dialogOf('prompt', 'Name?', 'Ada'));
  await answerDialog(fake.page, { accept: true, promptText: 'Grace' });
  await answerDialog(fake.page, { accept: false });
  assert.deepEqual(fake.sent, [
    { method: 'Page.handleJavaScriptDialog', params: { accept: true, promptText: 'Grace' } },
    { method: 'Page.handleJavaScriptDialog', params: { accept: false } },
  ]);
});

test('refuses to answer a dialog the page does not show', async () => {
  const fake = fakePage();
  await assert.rejects(answerDialog(fake.page, { accept: true }), /shows no dialog/);
  assert.deepEqual(fake.sent, []);
});

test("describes each kind of dialog, quoting the page's message", () => {
  assert.equal(describeDialog(confirmation), 'a confirmation asking "Delete it?"');
  assert.equal(
    describeDialog(dialogOf('alert', 'Saved "draft"')),
    'an alert saying "Saved \\"draft\\""',
  );
  assert.equal(
    describeDialog(dialogOf('prompt', 'Name?', 'Ada')),
    'a question asking "Name?", suggesting "Ada"',
  );
  assert.equal(describeDialog(dialogOf('beforeunload')), 'a question whether to leave the page');
  const long = describeDialog(dialogOf('alert', 'x'.repeat(2000)));
  assert.ok(long.length < 600, `${long.length} characters`);
});
