import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChromePage } from '../../../../src/host/chrome/pages/page.ts';
import { type } from '../../../../src/host/page-operations/actions.ts';

/** A page that records the commands sent to it. */
function recordingPage() {
  const sent: { readonly method: string; readonly params: Record<string, unknown> }[] = [];
  const page = {
    send(method: string, params: Record<string, unknown>) {
      sent.push({ method, params });
      return Promise.resolve({});
    },
  } as unknown as ChromePage;
  return { page, sent };
}

const CONTROL = 2;

test('typing over a field selects its text with Ctrl+A, then inserts the text', async () => {
  const { page, sent } = recordingPage();
  await type(page, 'hello', { element: undefined, replace: true, submit: false });
  assert.deepEqual(
    sent.map(({ method, params }) => [method, params['type'], params['key'], params['modifiers']]),
    [
      ['Input.dispatchKeyEvent', 'rawKeyDown', 'a', CONTROL],
      ['Input.dispatchKeyEvent', 'keyUp', 'a', CONTROL],
      ['Input.insertText', undefined, undefined, undefined],
    ],
  );
});

test('no key carries an editing command, which the page could apply to the next key', async () => {
  const { page, sent } = recordingPage();
  await type(page, '', { element: undefined, replace: true, submit: true });
  assert.ok(sent.length > 0);
  assert.ok(sent.every(({ params }) => params['commands'] === undefined));
});
