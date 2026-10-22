import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { removeEarlierVersionFiles } from '../../../../../src/host/chrome/profile/earlier-versions.ts';
import {
  mergePreferences,
  setChromePreferences,
} from '../../../../../src/host/chrome/profile/preferences.ts';
import { prepareProfile } from '../../../../../src/host/chrome/profile/profile.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-profile-'));
after(() => rm(scratch, { recursive: true, force: true }));

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

test("merges dsh-chrome's preferences into Chrome's, keeping the rest", () => {
  assert.deepEqual(
    mergePreferences(
      { browser: { custom_chrome_frame: true, window_placement: { maximized: true } }, intl: {} },
      { browser: { custom_chrome_frame: false } },
    ),
    { browser: { custom_chrome_frame: false, window_placement: { maximized: true } }, intl: {} },
  );
});

test("turns on the system title bar in the profile's preferences, a new profile's too", async () => {
  const profile = await mkdtemp(join(scratch, 'preferences-'));
  assert.equal(await setChromePreferences(profile), undefined);
  const path = join(profile, 'Default', 'Preferences');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    browser: { custom_chrome_frame: false },
  });
  await writeFile(path, JSON.stringify({ browser: { custom_chrome_frame: true }, homepage: 'x' }));
  assert.equal(await setChromePreferences(profile), undefined);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    browser: { custom_chrome_frame: false },
    homepage: 'x',
  });
});

test('leaves preferences it cannot read alone, and says so', async () => {
  const profile = await mkdtemp(join(scratch, 'unreadable-'));
  await mkdir(join(profile, 'Default'));
  await writeFile(join(profile, 'Default', 'Preferences'), '{ not json');
  assert.match((await setChromePreferences(profile)) ?? '', /could not set Chrome's preferences/);
  assert.equal(await readFile(join(profile, 'Default', 'Preferences'), 'utf8'), '{ not json');
});

test('moves the profile from where 0.2 kept it, makes it private, and links the native apps', async () => {
  const dir = await mkdtemp(join(scratch, 'move-'));
  const earlier = join(dir, 'profiles', 'dedicated');
  await mkdir(join(earlier, 'Default'), { recursive: true });
  await writeFile(join(earlier, 'Default', 'Cookies'), 'signed in');
  const userChrome = join(dir, 'chrome');
  await mkdir(join(userChrome, 'NativeMessagingHosts'), { recursive: true });
  await writeFile(join(userChrome, 'NativeMessagingHosts', 'com.example.passwords.json'), '{}');

  const profileDir = join(dir, 'chrome-profile');
  const warnings = await prepareProfile({
    profileDir,
    earlierProfileDirs: [earlier],
    nativeHostsFrom: userChrome,
    sharingRecordPath: join(dir, 'shared-native-hosts.json'),
  });
  assert.deepEqual(warnings, []);
  assert.equal(await readFile(join(profileDir, 'Default', 'Cookies'), 'utf8'), 'signed in');
  assert.equal(await exists(earlier), false);
  assert.equal(await exists(join(dir, 'profiles')), false);
  assert.equal((await stat(profileDir)).mode & 0o777, 0o700);
  assert.equal(
    await readlink(join(profileDir, 'NativeMessagingHosts', 'com.example.passwords.json')),
    join(userChrome, 'NativeMessagingHosts', 'com.example.passwords.json'),
  );
});

test('keeps a profile already in place, rather than one from before', async () => {
  const dir = await mkdtemp(join(scratch, 'keep-'));
  const earlier = join(dir, 'profiles', 'dedicated');
  await mkdir(earlier, { recursive: true });
  const profileDir = join(dir, 'chrome-profile');
  await mkdir(profileDir);
  await writeFile(join(profileDir, 'Local State'), 'current');
  await prepareProfile({
    profileDir,
    earlierProfileDirs: [earlier],
    nativeHostsFrom: undefined,
    sharingRecordPath: join(dir, 'shared-native-hosts.json'),
  });
  assert.equal(await readFile(join(profileDir, 'Local State'), 'utf8'), 'current');
  assert.equal(await exists(earlier), true);
});

test("removes what 0.1 and 0.2 left for their relay, but not another home's registration", async () => {
  const dir = await mkdtemp(join(scratch, 'earlier-'));
  const dataDir = join(dir, 'data');
  const userChromeDir = join(dir, 'chrome');
  const profileDir = join(dir, 'chrome-profile');
  for (const file of ['native-host.mjs', 'native-host-daily', 'native-host-dedicated']) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, file), '');
  }
  await mkdir(join(dataDir, 'extension'), { recursive: true });
  await writeFile(join(dataDir, 'extension', 'manifest.json'), '{}');
  const manifest = (chromeDir: string) =>
    join(chromeDir, 'NativeMessagingHosts', 'io.github.langify_org.dsh_chrome.json');
  await mkdir(join(userChromeDir, 'NativeMessagingHosts'), { recursive: true });
  await mkdir(join(profileDir, 'NativeMessagingHosts'), { recursive: true });
  // The user's Chrome names another DSH home's relay; the profile names this one's.
  await writeFile(
    manifest(userChromeDir),
    JSON.stringify({ path: '/other/home/native-host-daily' }),
  );
  await writeFile(
    manifest(profileDir),
    JSON.stringify({ path: join(dataDir, 'native-host-dedicated') }),
  );

  assert.deepEqual(await removeEarlierVersionFiles({ dataDir, userChromeDir, profileDir }), []);
  assert.equal(await exists(manifest(userChromeDir)), true);
  assert.equal(await exists(manifest(profileDir)), false);
  for (const file of [
    'native-host.mjs',
    'native-host-daily',
    'native-host-dedicated',
    'extension',
  ]) {
    assert.equal(await exists(join(dataDir, file)), false, file);
  }
});
