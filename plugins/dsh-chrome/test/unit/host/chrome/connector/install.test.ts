import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { installConnector } from '../../../../../src/host/chrome/connector/install.ts';
import { NATIVE_HOST_NAME } from '../../../../../src/protocol/connector.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-install-'));
after(() => rm(scratch, { recursive: true, force: true }));

/** A built plugin's files, as far as the installer copies them. */
async function fakeDist(dir: string): Promise<string> {
  await mkdir(join(dir, 'extension'), { recursive: true });
  await writeFile(join(dir, 'extension', 'manifest.json'), '{}');
  await mkdir(join(dir, 'bin'), { recursive: true });
  await writeFile(join(dir, 'bin', 'native-host.js'), '');
  return dir;
}

const manifestIn = (userDataDir: string) =>
  join(userDataDir, 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);
const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

test("takes back what it wrote for a profile turned off, and leaves another home's", async () => {
  const dir = await mkdtemp(join(scratch, 'retire-'));
  const distDir = await fakeDist(join(dir, 'dist'));
  const daily = { name: 'daily', userDataDir: join(dir, 'chrome') };
  const install = (profiles: (typeof daily)[], retiredProfiles: (typeof daily)[]) =>
    installConnector({
      distDir,
      dataDir: join(dir, 'data'),
      socketPath: join(dir, 'connector.sock'),
      nodePath: '/usr/bin/node',
      profiles,
      retiredProfiles,
    });

  await install([daily], []);
  assert.ok(await exists(manifestIn(daily.userDataDir)));
  await install([], [daily]);
  assert.equal(await exists(manifestIn(daily.userDataDir)), false);
  assert.equal(await exists(join(dir, 'data', 'native-host-daily')), false);

  // Another DSH home registered its own relay with this Chrome since; it stays.
  const elsewhere = '{"path": "/other/home/dsh-chrome/native-host-daily"}\n';
  await writeFile(manifestIn(daily.userDataDir), elsewhere);
  await install([], [daily]);
  assert.equal(await readFile(manifestIn(daily.userDataDir), 'utf8'), elsewhere);
});

test("lets a profile reach the native apps another's reach, keeping links the user made", async () => {
  const dir = await mkdtemp(join(scratch, 'share-'));
  const distDir = await fakeDist(join(dir, 'dist'));
  const own = join(dir, 'chrome', 'NativeMessagingHosts');
  await mkdir(own, { recursive: true });
  for (const app of ['com.example.passwords.json', 'org.example.replaced.json', 'notes.txt']) {
    await writeFile(join(own, app), '{}');
  }
  const dedicated = join(dir, 'dedicated');
  await mkdir(join(dedicated, 'NativeMessagingHosts'), { recursive: true });
  await symlink(
    '/elsewhere.json',
    join(dedicated, 'NativeMessagingHosts', 'org.example.replaced.json'),
  );

  await installConnector({
    distDir,
    dataDir: join(dir, 'data'),
    socketPath: join(dir, 'connector.sock'),
    nodePath: '/usr/bin/node',
    profiles: [
      { name: 'daily', userDataDir: join(dir, 'chrome') },
      { name: 'dedicated', userDataDir: dedicated, nativeHostsFrom: join(dir, 'chrome') },
    ],
  });
  const hosts = join(dedicated, 'NativeMessagingHosts');
  assert.equal(
    await readlink(join(hosts, 'com.example.passwords.json')),
    join(own, 'com.example.passwords.json'),
  );
  assert.equal(await readlink(join(hosts, 'org.example.replaced.json')), '/elsewhere.json');
  assert.equal(await exists(join(hosts, 'notes.txt')), false);
  // Its own relay's manifest is its own, not a link to the other profile's.
  const relay = JSON.parse(await readFile(manifestIn(dedicated), 'utf8'));
  assert.equal(relay.path, join(dir, 'data', 'native-host-dedicated'));
});

test('takes back the links it made once sharing is off, and leaves those it did not make', async () => {
  const dir = await mkdtemp(join(scratch, 'unshare-'));
  const distDir = await fakeDist(join(dir, 'dist'));
  const own = join(dir, 'chrome', 'NativeMessagingHosts');
  await mkdir(own, { recursive: true });
  for (const app of ['com.example.passwords.json', 'org.example.notes.json']) {
    await writeFile(join(own, app), '{}');
  }
  const dedicated = join(dir, 'dedicated');
  const hosts = join(dedicated, 'NativeMessagingHosts');
  const install = (sharing: boolean) =>
    installConnector({
      distDir,
      dataDir: join(dir, 'data'),
      socketPath: join(dir, 'connector.sock'),
      nodePath: '/usr/bin/node',
      profiles: [
        {
          name: 'dedicated',
          userDataDir: dedicated,
          ...(sharing ? { nativeHostsFrom: join(dir, 'chrome') } : {}),
        },
      ],
    });

  assert.deepEqual((await install(true)).warnings, []);
  // The user points one of the links elsewhere.
  await rm(join(hosts, 'org.example.notes.json'));
  await symlink('/elsewhere.json', join(hosts, 'org.example.notes.json'));

  assert.deepEqual((await install(false)).warnings, []);
  assert.equal(await exists(join(hosts, 'com.example.passwords.json')), false);
  assert.equal(await readlink(join(hosts, 'org.example.notes.json')), '/elsewhere.json');
});
