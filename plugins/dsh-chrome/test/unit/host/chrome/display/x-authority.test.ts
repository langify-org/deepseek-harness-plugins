import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  writeXAuthority,
  X_COOKIE_NAME,
} from '../../../../../src/host/chrome/display/x-authority.ts';
import { cookieOf } from '../../../../support/x11-probe.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-xauth-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('writes one entry for every display: no address, no display number, a 16-byte cookie', async () => {
  const path = join(scratch, 'Xauthority');
  await writeXAuthority(path);
  const file = await readFile(path);
  assert.equal(file.readUInt16BE(0), 0xffff);
  assert.equal(file.readUInt16BE(2), 0);
  assert.equal(file.readUInt16BE(4), 0);
  const cookie = cookieOf(file);
  assert.equal(cookie.name, X_COOKIE_NAME);
  assert.equal(cookie.data.length, 16);
  assert.equal(file.length, 6 + 2 + X_COOKIE_NAME.length + 2 + 16);
});

test('writes a new cookie each time, readable by the user only', async () => {
  const path = join(scratch, 'again');
  await writeFile(path, 'left from before', { mode: 0o644 });
  await writeXAuthority(path);
  const first = cookieOf(await readFile(path)).data;
  await writeXAuthority(path);
  const second = cookieOf(await readFile(path)).data;
  assert.notDeepEqual(first, second);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});
