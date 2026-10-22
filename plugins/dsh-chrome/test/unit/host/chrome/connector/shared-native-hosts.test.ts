import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { shareNativeHosts } from '../../../../../src/host/chrome/connector/shared-native-hosts.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-share-'));
after(() => rm(scratch, { recursive: true, force: true }));

async function nativeHostsWith(dir: string, manifests: readonly string[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const manifest of manifests) await writeFile(join(dir, manifest), '{}');
  return dir;
}

test('shares what it can and says what it cannot, without failing', async () => {
  const dir = await mkdtemp(join(scratch, 'partly-'));
  const from = await nativeHostsWith(join(dir, 'chrome', 'NativeMessagingHosts'), [
    'com.example.passwords.json',
  ]);
  // One profile's directory is a file, so no link can go in it; the other is fine.
  await writeFile(join(dir, 'blocked'), 'not a directory');
  const fine = join(dir, 'fine', 'NativeMessagingHosts');
  const warnings = await shareNativeHosts(join(dir, 'record.json'), [
    { from, to: join(dir, 'blocked', 'NativeMessagingHosts') },
    { from, to: fine },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /could not share the native app com\.example\.passwords\.json/);
  assert.equal(
    await readlink(join(fine, 'com.example.passwords.json')),
    join(from, 'com.example.passwords.json'),
  );
});

test('records the links it made, and takes a link already pointing at a manifest as one', async () => {
  const dir = await mkdtemp(join(scratch, 'record-'));
  const from = await nativeHostsWith(join(dir, 'chrome', 'NativeMessagingHosts'), [
    'com.example.passwords.json',
  ]);
  const to = join(dir, 'dedicated', 'NativeMessagingHosts');
  const record = join(dir, 'record.json');
  assert.deepEqual(await shareNativeHosts(record, [{ from, to }]), []);
  const link = join(to, 'com.example.passwords.json');
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), {
    links: { [link]: join(from, 'com.example.passwords.json') },
  });

  // Without its record, as after an earlier version made the link, it is taken as its own.
  await rm(record);
  assert.deepEqual(await shareNativeHosts(record, [{ from, to }]), []);
  assert.deepEqual(await shareNativeHosts(record, []), []);
  await assert.rejects(readlink(link), { code: 'ENOENT' });
});

test('starts afresh from a record it cannot read, saying so', async () => {
  const dir = await mkdtemp(join(scratch, 'corrupt-'));
  const record = join(dir, 'record.json');
  await writeFile(record, '{ not json');
  const warnings = await shareNativeHosts(record, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /is not JSON/);
  assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), { links: {} });
});
