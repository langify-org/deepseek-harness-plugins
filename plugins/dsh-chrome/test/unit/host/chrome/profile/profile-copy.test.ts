import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import {
  REPLACED_PROFILE_DIRECTORY,
  readUserChrome,
  removeUnfinishedCopy,
  stageProfileCopy,
} from '../../../../../src/host/chrome/profile/profile-copy.ts';

const roots: string[] = [];
let userDir = '';
let ownDir = '';

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chrome-profile-copy-'));
  roots.push(root);
  userDir = join(root, 'user-chrome');
  ownDir = join(root, 'dsh-chrome-profile');
  await mkdir(userDir);
});

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function writeLocalState(cache: Record<string, unknown>): Promise<void> {
  await writeFile(join(userDir, 'Local State'), JSON.stringify({ profile: { info_cache: cache } }));
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

/** A user profile with the things a copy keeps and the things it leaves out. */
async function makeUserProfile(directory = 'Default'): Promise<string> {
  const profile = join(userDir, directory);
  await put(
    join(profile, 'Preferences'),
    JSON.stringify({
      profile: { exit_type: 'Crashed', name: 'Me' },
      sync: {
        transport_data_per_account: { x: 1 },
        local_device_guids_with_timestamp: [1],
        keep: true,
      },
      invalidation: { client_id: 'abc' },
      extensions: { settings: {} },
    }),
  );
  await put(join(profile, 'Cookies'), 'cookies');
  await put(join(profile, 'Extensions', 'abc', '1.0', 'manifest.json'), '{}');
  await put(join(profile, 'Local Storage', 'leveldb', '000003.log'), 'ls');
  for (const left of [
    'Cache/data',
    'Code Cache/js/a',
    'GPUCache/x',
    'Sessions/Session_1',
    'Session Storage/000003.log',
    'Sync Data/LevelDB/1',
    'GCM Store/1',
    'Service Worker/CacheStorage/c',
    'Service Worker/ScriptCache/s',
    'Current Session',
    'Last Tabs',
  ]) {
    await put(join(profile, ...left.split('/')), 'left out');
  }
  await put(join(profile, 'Service Worker', 'Database', 'kept'), 'kept');
  return profile;
}

/** The copy beside dsh-chrome's profile, while one is staged: its name is the copy's own. */
function stagedCopy(): string {
  const staged = readdirSync(ownDir).filter((entry) => entry.startsWith('Default.copying-'));
  assert.equal(staged.length, 1, `one staged copy, not ${JSON.stringify(staged)}`);
  return join(ownDir, staged[0] as string);
}

/** Whether any copy is staged beside dsh-chrome's profile. */
function anyStagedCopy(): boolean {
  return (
    existsSync(ownDir) && readdirSync(ownDir).some((entry) => entry.startsWith('Default.copying-'))
  );
}

test('lists the profiles Local State names that exist as directories, with name and account', async () => {
  await writeLocalState({
    Default: { name: 'Person 1', user_name: 'me@example.com' },
    'Profile 1': { name: 'Work' },
    'Profile 2': { name: 'Gone' },
    Unnamed: {},
  });
  await mkdir(join(userDir, 'Default'));
  await mkdir(join(userDir, 'Profile 1'));
  await mkdir(join(userDir, 'Unnamed'));
  await writeFile(join(userDir, 'Profile 2'), 'a file, not a profile');
  const { profiles } = await readUserChrome(userDir);
  assert.deepEqual(profiles, [
    { directory: 'Default', name: 'Person 1', account: 'me@example.com' },
    { directory: 'Profile 1', name: 'Work', account: undefined },
    { directory: 'Unnamed', name: 'Unnamed', account: undefined },
  ]);
});

test('does not list a profile whose name leaves the user data directory', async () => {
  await writeLocalState({ '..': { name: 'Up' }, 'a/b': { name: 'Deep' } });
  await mkdir(join(userDir, 'a'));
  assert.deepEqual((await readUserChrome(userDir)).profiles, []);
});

test('says why when there is no Local State', async () => {
  await assert.rejects(readUserChrome(userDir), /found no Chrome profiles/);
});

test('says Chrome runs when SingletonLock names a live process on this host', async () => {
  await writeLocalState({});
  await symlink(`${hostname()}-${process.pid}`, join(userDir, 'SingletonLock'));
  assert.equal((await readUserChrome(userDir)).running, true);
});

test('says Chrome does not run without a lock, or when the lock is another host’s or a dead process’s', async () => {
  await writeLocalState({});
  assert.equal((await readUserChrome(userDir)).running, false);
  const lock = join(userDir, 'SingletonLock');
  await symlink(`some-other-host-${process.pid}`, lock);
  assert.equal((await readUserChrome(userDir)).running, false);
  await rm(lock);
  // A pid above the kernel's maximum belongs to no process.
  await symlink(`${hostname()}-4194999`, lock);
  assert.equal((await readUserChrome(userDir)).running, false);
  await rm(lock);
  await symlink(`${hostname()}-notapid`, lock);
  assert.equal((await readUserChrome(userDir)).running, false);
});

test('copies a listed profile and keeps what Chrome needs, leaving out caches and sessions', async () => {
  await writeLocalState({ Default: { name: 'Me' } });
  await makeUserProfile();
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  const copy = stagedCopy();
  assert.equal(await readFile(join(copy, 'Cookies'), 'utf8'), 'cookies');
  assert.equal(
    await readFile(join(copy, 'Extensions', 'abc', '1.0', 'manifest.json'), 'utf8'),
    '{}',
  );
  assert.equal(await readFile(join(copy, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'ls');
  assert.equal(await readFile(join(copy, 'Service Worker', 'Database', 'kept'), 'utf8'), 'kept');
  for (const left of [
    'Cache',
    'Code Cache',
    'GPUCache',
    'Sessions',
    'Session Storage',
    'Sync Data',
    'GCM Store',
    join('Service Worker', 'CacheStorage'),
    join('Service Worker', 'ScriptCache'),
    'Current Session',
    'Last Tabs',
  ]) {
    assert.equal(existsSync(join(copy, left)), false, `${left} is left out`);
  }
  await staged.discard();
});

test('makes the copy a device of its own by editing its Preferences', async () => {
  await writeLocalState({ Default: { name: 'Me' } });
  const profile = await makeUserProfile();
  const original = await readFile(join(profile, 'Preferences'), 'utf8');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  const preferences = JSON.parse(await readFile(join(stagedCopy(), 'Preferences'), 'utf8'));
  assert.deepEqual(preferences, {
    profile: { exit_type: 'Normal', name: 'Me' },
    sync: { keep: true },
    extensions: { settings: {} },
  });
  assert.equal(
    await readFile(join(profile, 'Preferences'), 'utf8'),
    original,
    'the original is untouched',
  );
  await staged.discard();
});

test('copies a profile without Preferences', async () => {
  await writeLocalState({ Default: {} });
  await put(join(userDir, 'Default', 'Cookies'), 'c');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  assert.equal(await readFile(join(stagedCopy(), 'Cookies'), 'utf8'), 'c');
  await staged.discard();
});

test('copies a SQLite database whole, readable and with its rows', async () => {
  await writeLocalState({ Default: {} });
  await mkdir(join(userDir, 'Default'));
  const database = new DatabaseSync(join(userDir, 'Default', 'History'));
  database.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT)');
  database.exec("INSERT INTO urls (url) VALUES ('https://example.com/')");
  database.close();
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  const copy = new DatabaseSync(join(stagedCopy(), 'History'), { readOnly: true });
  try {
    assert.deepEqual(
      copy
        .prepare('SELECT url FROM urls')
        .all()
        .map((row) => ({ ...row })),
      [{ url: 'https://example.com/' }],
    );
  } finally {
    copy.close();
  }
  await staged.discard();
});

test('refuses a profile Local State does not list', async () => {
  await writeLocalState({ Default: {} });
  await mkdir(join(userDir, 'Default'));
  await mkdir(join(userDir, 'Other'));
  for (const directory of ['Other', '../x', 'Missing']) {
    await assert.rejects(
      stageProfileCopy({ userChromeDir: userDir, directory, profileDir: ownDir }),
      /has no profile/,
    );
  }
  assert.equal(anyStagedCopy(), false);
});

test('install puts the copy in place of Default and keeps the old one aside', async () => {
  await writeLocalState({ Default: {} });
  await put(join(userDir, 'Default', 'Cookies'), 'new');
  await put(join(ownDir, 'Default', 'Cookies'), 'old');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  await staged.install();
  assert.equal(await readFile(join(ownDir, 'Default', 'Cookies'), 'utf8'), 'new');
  assert.equal(await readFile(join(ownDir, REPLACED_PROFILE_DIRECTORY, 'Cookies'), 'utf8'), 'old');
  assert.equal(anyStagedCopy(), false);
});

test('install replaces the profile an earlier copy kept aside', async () => {
  await writeLocalState({ Default: {} });
  await put(join(userDir, 'Default', 'Cookies'), 'new');
  await put(join(ownDir, 'Default', 'Cookies'), 'current');
  await put(join(ownDir, REPLACED_PROFILE_DIRECTORY, 'Older'), 'older');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  await staged.install();
  assert.equal(
    await readFile(join(ownDir, REPLACED_PROFILE_DIRECTORY, 'Cookies'), 'utf8'),
    'current',
  );
  assert.equal(existsSync(join(ownDir, REPLACED_PROFILE_DIRECTORY, 'Older')), false);
});

test('install works when there was no Default', async () => {
  await writeLocalState({ Default: {} });
  await put(join(userDir, 'Default', 'Cookies'), 'new');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  await staged.install();
  assert.equal(await readFile(join(ownDir, 'Default', 'Cookies'), 'utf8'), 'new');
  assert.equal(existsSync(join(ownDir, REPLACED_PROFILE_DIRECTORY)), false);
});

test('installs a profile of another name as Default', async () => {
  await writeLocalState({ 'Profile 1': {} });
  await put(join(userDir, 'Profile 1', 'Cookies'), 'work');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Profile 1',
    profileDir: ownDir,
  });
  await staged.install();
  assert.equal(await readFile(join(ownDir, 'Default', 'Cookies'), 'utf8'), 'work');
});

test('discard removes the copy and leaves Default alone', async () => {
  await writeLocalState({ Default: {} });
  await put(join(userDir, 'Default', 'Cookies'), 'new');
  await put(join(ownDir, 'Default', 'Cookies'), 'old');
  const staged = await stageProfileCopy({
    userChromeDir: userDir,
    directory: 'Default',
    profileDir: ownDir,
  });
  assert.equal(anyStagedCopy(), true);
  await staged.discard();
  assert.equal(anyStagedCopy(), false);
  assert.equal(await readFile(join(ownDir, 'Default', 'Cookies'), 'utf8'), 'old');
});

test('removeUnfinishedCopy removes the copies earlier runs left, and does nothing without one', async () => {
  await put(join(ownDir, 'Default.copying-0a1b2c', 'Cookies'), 'half');
  await put(join(ownDir, 'Default.copying-3d4e5f', 'Cookies'), 'half');
  await put(join(ownDir, 'Default', 'Cookies'), 'kept');
  await removeUnfinishedCopy(ownDir);
  assert.equal(anyStagedCopy(), false);
  assert.equal(await readFile(join(ownDir, 'Default', 'Cookies'), 'utf8'), 'kept');
  await removeUnfinishedCopy(ownDir);
});

test('an aborted copy stops, and leaves no copy behind', async () => {
  await writeLocalState({ Default: { name: 'Me' } });
  await put(join(userDir, 'Default', 'Cookies'), 'c');
  await put(join(userDir, 'Default', 'Extensions', 'x', 'manifest.json'), '{}');
  const abort = new AbortController();
  abort.abort(new Error('the plugin stops'));
  await assert.rejects(
    stageProfileCopy({
      userChromeDir: userDir,
      directory: 'Default',
      profileDir: ownDir,
      signal: abort.signal,
    }),
    /the plugin stops/,
  );
  assert.equal(anyStagedCopy(), false);
});
