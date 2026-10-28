import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isCopying,
  ProfileCopier,
  type ProfileCopierOptions,
} from '../../../../src/client/settings/profile-copier.ts';
import type { ProfileCopyStatus } from '../../../../src/protocol/viewer.ts';
import { FakeSocket } from '../fake-socket.ts';

/** A copier whose sockets the test opens; it connects again at once after a drop. */
function startCopier(options: ProfileCopierOptions = {}) {
  const sockets: FakeSocket[] = [];
  const copier = new ProfileCopier(
    () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    { reconnectDelayMs: () => 0, ...options },
  );
  const socket = () => {
    const last = sockets.at(-1);
    assert.ok(last !== undefined);
    return last;
  };
  socket().open();
  return { copier, sockets, socket };
}

/** Waits for the copier's timers. */
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

const profiles = [{ directory: 'Default', name: 'Person 1', account: null }];
/** A copy that started at 100, and an earlier one, at 50. */
const checking: ProfileCopyStatus = {
  kind: 'checking-databases',
  directory: 'Default',
  startedAt: 100,
  checked: 3,
  total: 31,
};
const copied: ProfileCopyStatus = { kind: 'copied', directory: 'Default', startedAt: 100 };
const earlier: ProfileCopyStatus = { kind: 'copied', directory: 'Profile 2', startedAt: 50 };

test('asks for the profiles of the user’s Chrome once connected, and shows no copy while there is none', () => {
  const { copier, socket } = startCopier();
  assert.deepEqual(socket().sent, [{ type: 'user-chrome' }]);
  socket().receive({ type: 'profile-copy', copy: null });
  socket().receive({ type: 'user-chrome', profiles, running: true });
  assert.deepEqual(copier.getSnapshot().profiles, profiles);
  assert.equal(copier.getSnapshot().running, true);
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'idle' });
  copier.dispose();
});

test('follows a copy from the request to its end, as the host tells it', () => {
  const { copier, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: null });
  copier.copy('Default');
  assert.deepEqual(socket().sent.at(-1), { type: 'copy-profile', directory: 'Default' });
  assert.deepEqual(copier.getSnapshot().phase, {
    kind: 'asked',
    directory: 'Default',
    after: undefined,
  });
  const steps: ProfileCopyStatus[] = [
    {
      kind: 'copying-files',
      directory: 'Default',
      startedAt: 100,
      copiedBytes: 0,
      totalBytes: 2_000_000,
    },
    {
      kind: 'copying-files',
      directory: 'Default',
      startedAt: 100,
      copiedBytes: 1_000_000,
      totalBytes: 2_000_000,
    },
    checking,
    { kind: 'replacing', directory: 'Default', startedAt: 100 },
  ];
  for (const copy of steps) {
    socket().receive({ type: 'profile-copy', copy });
    assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: copy });
    assert.equal(isCopying(copier.getSnapshot().phase), true);
  }
  // While it runs, a second copy is not asked for.
  copier.copy('Default');
  assert.equal(socket().sent.filter((request) => request.type === 'copy-profile').length, 1);
  socket().receive({ type: 'profile-copy', copy: copied });
  assert.equal(isCopying(copier.getSnapshot().phase), false);
  copier.dispose();
});

test('a page opened during a copy, or after it, shows it from what the host tells first', () => {
  for (const copy of [checking, copied]) {
    const { copier, socket } = startCopier();
    socket().receive({ type: 'profile-copy', copy });
    assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: copy });
    copier.dispose();
  }
});

test('a page that asked for a copy waits for it, while the host still tells of the earlier one', () => {
  const { copier, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: earlier });
  copier.copy('Default');
  socket().receive({ type: 'profile-copy', copy: earlier });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'asked', directory: 'Default', after: 50 });
  socket().receive({ type: 'profile-copy', copy: checking });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: checking });
  copier.dispose();
});

test('a copy the host refuses to begin says why, and one that fails once begun keeps its reason', () => {
  const { copier, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: null });
  copier.copy('Default');
  socket().receive({
    type: 'failed',
    requestType: 'copy-profile',
    requestId: null,
    message: 'a profile is being copied already',
  });
  assert.deepEqual(copier.getSnapshot().phase, {
    kind: 'refused',
    message: 'a profile is being copied already',
  });

  copier.copy('Default');
  const failed: ProfileCopyStatus = {
    kind: 'failed',
    directory: 'Default',
    startedAt: 100,
    message: 'History changed each time it was copied',
  };
  socket().receive({ type: 'profile-copy', copy: failed });
  // The request fails as well, with the same reason: what the copy said stays.
  socket().receive({
    type: 'failed',
    requestType: 'copy-profile',
    requestId: null,
    message: failed.message,
  });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: failed });
  copier.dispose();
});

test('after a drop during a copy, connects again and shows how the copy went meanwhile', async () => {
  const { copier, sockets, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: null });
  copier.copy('Default');
  socket().receive({ type: 'profile-copy', copy: checking });
  socket().drop();
  assert.deepEqual(copier.getSnapshot().phase, {
    kind: 'connection-lost',
    directory: 'Default',
    after: undefined,
  });
  // No second copy while the outcome of the first is unknown.
  copier.copy('Default');
  await wait();
  assert.equal(sockets.length, 2);
  socket().open();
  assert.deepEqual(socket().sent, [{ type: 'user-chrome' }]);
  socket().receive({ type: 'profile-copy', copy: copied });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: copied });
  copier.dispose();
});

test('a copy the host knows no more, once connected again, may not have finished', async () => {
  const { copier, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: null });
  copier.copy('Default');
  socket().receive({ type: 'profile-copy', copy: checking });
  socket().drop();
  await wait();
  socket().open();
  // dsh-chrome started anew meanwhile, which stopped the copy.
  socket().receive({ type: 'profile-copy', copy: null });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'unfinished', directory: 'Default' });
  assert.equal(isCopying(copier.getSnapshot().phase), false);
  copier.dispose();
});

test('a request lost in a drop is not taken for the earlier copy the host tells of', async () => {
  const { copier, socket } = startCopier();
  socket().receive({ type: 'profile-copy', copy: earlier });
  copier.copy('Default');
  socket().drop();
  await wait();
  socket().open();
  socket().receive({ type: 'profile-copy', copy: earlier });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'unfinished', directory: 'Default' });
  copier.dispose();
});

test('during a copy, a host gone silent is asked again, and then connected to again', async () => {
  const { copier, sockets, socket } = startCopier({
    checkEveryMs: 5,
    askAfterMs: 30,
    reconnectAfterMs: 150,
  });
  socket().receive({ type: 'profile-copy', copy: null });
  copier.copy('Default');
  socket().receive({ type: 'profile-copy', copy: checking });
  const first = socket();
  await wait(80);
  assert.ok(first.sent.filter((request) => request.type === 'user-chrome').length >= 2);
  assert.equal(sockets.length, 1);
  await wait(150);
  // A connection a proxy left half open: no close came, yet the page connects again.
  assert.equal(sockets.length, 2);
  assert.equal(copier.getSnapshot().phase.kind, 'connection-lost');
  socket().open();
  socket().receive({ type: 'profile-copy', copy: copied });
  assert.deepEqual(copier.getSnapshot().phase, { kind: 'host', status: copied });
  copier.dispose();
});

test('a silent host is not asked again while no copy is waited for', async () => {
  const { copier, socket } = startCopier({ checkEveryMs: 5, askAfterMs: 10, reconnectAfterMs: 20 });
  socket().receive({ type: 'profile-copy', copy: copied });
  await wait(40);
  assert.deepEqual(socket().sent, [{ type: 'user-chrome' }]);
  copier.dispose();
});

test('the attempts to connect start over once the host answers, not once a socket opens', async () => {
  const attempts: number[] = [];
  const { copier, socket } = startCopier({
    reconnectDelayMs: (attempt) => {
      attempts.push(attempt);
      return 0;
    },
  });
  socket().drop();
  await wait();
  // A host that takes the connection and drops it at once.
  socket().open();
  socket().drop();
  await wait();
  socket().open();
  socket().receive({ type: 'profile-copy', copy: null });
  socket().drop();
  await wait();
  assert.deepEqual(attempts, [0, 1, 0]);
  copier.dispose();
});

test('a disposed copier connects no more', async () => {
  const { copier, sockets, socket } = startCopier();
  copier.dispose();
  socket().drop();
  await wait();
  assert.equal(sockets.length, 1);
});

test('a copy asked for while the page is not connected is refused at once', () => {
  const socket = new FakeSocket();
  const copier = new ProfileCopier(() => socket);
  copier.copy('Default');
  assert.equal(copier.getSnapshot().phase.kind, 'refused');
  assert.deepEqual(socket.sent, []);
  copier.dispose();
});
