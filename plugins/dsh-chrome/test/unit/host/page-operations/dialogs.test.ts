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
    send(method: string, params: unknown) {
      fake.sent.push({ method, params });
      return Promise.resolve({});
    },
  } as unknown as ChromePage;
  return Object.assign(fake, { page });
}

const confirmation: PageDialog = { kind: 'confirm', message: 'Delete it?', defaultPrompt: '' };

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

test("answers the page's dialog, with a prompt's text when given", async () => {
  const fake = fakePage();
  fake.showDialog({ kind: 'prompt', message: 'Name?', defaultPrompt: 'Ada' });
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
    describeDialog({ kind: 'alert', message: 'Saved "draft"', defaultPrompt: '' }),
    'an alert saying "Saved \\"draft\\""',
  );
  assert.equal(
    describeDialog({ kind: 'prompt', message: 'Name?', defaultPrompt: 'Ada' }),
    'a question asking "Name?", suggesting "Ada"',
  );
  assert.equal(
    describeDialog({ kind: 'beforeunload', message: '', defaultPrompt: '' }),
    'a question whether to leave the page',
  );
  const long = describeDialog({ kind: 'alert', message: 'x'.repeat(2000), defaultPrompt: '' });
  assert.ok(long.length < 600, `${long.length} characters`);
});
