/**
 * The built plugin against DSH's own Host packages, at the versions it declares
 * (`engines.dsh`): DSH's compatibility check, a real Cordis context, DSH's web server and
 * connection service admitting the viewer's routes, and the tools' definitions.
 *
 * No Chrome runs here: the X server it would need is named but missing, so starting it fails
 * as it would on a machine without it. Needs a build (`pnpm build`). Everything it writes
 * stays in a temporary directory.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import WebSocket from 'ws';
import packageJson from '../../package.json' with { type: 'json' };
import {
  decodeViewerEvent,
  SCREEN_PATH,
  VIEWER_PATH,
  type ViewerEvent,
} from '../../src/protocol/viewer.ts';
import { type DshHost, SIGNED_IN_COOKIE, startDshHost } from '../support/dsh-host.ts';
import { distDir, missingRequirements } from '../support/environment.ts';
import { RecordingTools } from '../support/recording-tools.ts';

const skip = await missingRequirements({});

/** The manifest of a native app, as the user's own Chrome lists it. */
const NATIVE_APP_MANIFEST = 'com.example.desktop_app.json';
/** An X server that is not there. */
const MISSING_XVNC = '/nonexistent/Xvnc';

/** The plugin's configuration with every place it keeps files in the directory. */
function configIn(dir: string): Record<string, unknown> {
  return {
    xvncExecutable: MISSING_XVNC,
    profileDir: join(dir, 'chrome-profile'),
    userChromeDir: join(dir, 'chrome'),
    dataDir: join(dir, 'data'),
    runtimeDir: join(dir, 'run'),
  };
}

let workDir = '';
let host: DshHost | undefined;
let root: Context | undefined;
let port = 0;

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-compat-'));
  host = await startDshHost();
  const started = host.root;
  root = started;
  await started.plugin(RecordingTools);
  // A native app the user's own Chrome reaches, such as a password manager's desktop app.
  await mkdir(join(workDir, 'chrome', 'NativeMessagingHosts'), { recursive: true });
  await writeFile(join(workDir, 'chrome', 'NativeMessagingHosts', NATIVE_APP_MANIFEST), '{}\n');
  const plugin = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
  await started.plugin(plugin, configIn(workDir));
  await started.plugin(await import(pathToFileURL(join(distDir, 'host', 'tools.js')).href));
  await started.plugin(await import(pathToFileURL(join(distDir, 'host', 'context.js')).href));
  port = started.webServer.port ?? 0;
});

after(async () => {
  await host?.dispose();
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

test('the declared DSH range accepts this DSH release and refuses the next minor', { skip }, () => {
  assert.equal(evaluatePluginCompatibility(packageJson, {}, '0.2.1-rc.2'), undefined);
  assert.equal(evaluatePluginCompatibility(packageJson, {}, '0.2.4'), undefined);
  assert.notEqual(evaluatePluginCompatibility(packageJson, {}, '0.3.0'), undefined);
  assert.notEqual(evaluatePluginCompatibility(packageJson, {}, '0.2.1-alpha.4'), undefined);
});

test("starting readies the profile, with the user's native apps, and starts no Chrome", {
  skip,
}, async () => {
  assert.equal(
    await readlink(join(workDir, 'chrome-profile', 'NativeMessagingHosts', NATIVE_APP_MANIFEST)),
    join(workDir, 'chrome', 'NativeMessagingHosts', NATIVE_APP_MANIFEST),
  );
  assert.deepEqual(root?.get('chrome')?.state, { kind: 'stopped' });
});

test("the viewer's routes refuse requests DSH would not authenticate", { skip }, async () => {
  const origin = `http://127.0.0.1:${port}`;
  for (const path of [VIEWER_PATH, SCREEN_PATH]) {
    assert.equal(await upgradeStatus(path, { origin }), 401, path);
    assert.equal(
      await upgradeStatus(path, { origin: 'https://elsewhere.example', cookie: SIGNED_IN_COOKIE }),
      403,
      path,
    );
  }
});

test('a signed-in viewer watches its session, owns the screen, and hears why Chrome did not start', {
  skip,
}, async () => {
  const socket = signedInSocket(VIEWER_PATH);
  const events = eventQueue(socket);
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  socket.send(JSON.stringify({ type: 'watch', sessionId: 'session-1' }));
  assert.deepEqual(await events.next(), { type: 'chrome', status: { kind: 'stopped' } });
  assert.deepEqual(await events.next(), { type: 'help', request: null });
  // The only viewer owns the screen: it is laid out at its size.
  assert.deepEqual(await events.next(), { type: 'screen', owner: true });

  socket.send(JSON.stringify({ type: 'open', url: 'example.com' }));
  assert.deepEqual(await events.next(), { type: 'chrome', status: { kind: 'starting' } });
  const failedStart = await events.next();
  assert.ok(failedStart.type === 'chrome' && failedStart.status.kind === 'failed');
  assert.match(failedStart.status.message, /Xvnc \(\/nonexistent\/Xvnc\) was not found/);
  const failure = await events.next();
  assert.ok(failure.type === 'failed', JSON.stringify(failure));
  assert.equal(failure.requestType, 'open');
  socket.close();
});

test('the screen route closes with the reason the screen did not start', { skip }, async () => {
  const socket = signedInSocket(SCREEN_PATH);
  const { code, reason } = await new Promise<{ code: number; reason: string }>((resolve) =>
    socket.once('close', (closeCode, closeReason) =>
      resolve({ code: closeCode, reason: closeReason.toString() }),
    ),
  );
  assert.equal(code, 1011);
  assert.match(reason, /^the screen did not start: Xvnc/);
});

test('the host row finishes starting only once ctx.chrome is available', { skip }, async () => {
  // DSH reports the rows that inject `chrome` (tools, context) as not activated when the
  // service is still starting at the moment the host row counts as started.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-compat-start-'));
  const separate = await startDshHost();
  try {
    const plugin = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
    await separate.root.plugin(plugin, configIn(dir));
    assert.notEqual(separate.root.get('chrome'), undefined);
  } finally {
    await separate.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the tools row registers every chrome tool with a valid definition', { skip }, () => {
  const tools = root?.get('tools') as RecordingTools | undefined;
  assert.deepEqual(tools?.registered.map((tool) => tool.name).sort(), [
    'chrome_answer_dialog',
    'chrome_ask_user',
    'chrome_click',
    'chrome_close',
    'chrome_navigate',
    'chrome_open',
    'chrome_pages',
    'chrome_press',
    'chrome_screenshot',
    'chrome_scroll',
    'chrome_snapshot',
    'chrome_type',
  ]);
  for (const tool of tools?.registered ?? []) {
    assert.equal(tool.parameters['type'], 'object', tool.name);
  }
});

function signedInSocket(path: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: { origin: `http://127.0.0.1:${port}`, cookie: SIGNED_IN_COOKIE },
  });
}

/** The HTTP status a WebSocket upgrade gets back, or 101 when it succeeds. */
function upgradeStatus(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.once('open', () => {
      resolve(101);
      socket.close();
    });
    socket.once('error', (error) => {
      if (!socket.listenerCount('unexpected-response')) reject(error);
    });
  });
}

function eventQueue(socket: WebSocket): { next(): Promise<ViewerEvent> } {
  const received: ViewerEvent[] = [];
  const waiting: ((event: ViewerEvent) => void)[] = [];
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const event = decodeViewerEvent(data.toString());
    if (event === undefined) return;
    const resolve = waiting.shift();
    if (resolve === undefined) received.push(event);
    else resolve(event);
  });
  return {
    next: () => {
      const event = received.shift();
      return event === undefined
        ? new Promise((resolve) => waiting.push(resolve))
        : Promise.resolve(event);
    },
  };
}
