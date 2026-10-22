/**
 * The built plugin against DSH's own Host packages, at the versions it declares
 * (`engines.dsh`): DSH's compatibility check, a real Cordis context, DSH's web server and
 * connection service admitting the viewer route, and the tools' definitions.
 *
 * Needs a build (`pnpm build`). Everything it writes stays in a temporary directory.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import WebSocket from 'ws';
import packageJson from '../../package.json' with { type: 'json' };
import { NATIVE_HOST_NAME } from '../../src/protocol/connector.ts';
import { CONNECTOR_EXTENSION_ID } from '../../src/protocol/connector-identity.ts';
import { decodeViewerEvent, VIEWER_PATH, type ViewerEvent } from '../../src/protocol/viewer.ts';
import { type DshHost, SIGNED_IN_COOKIE, startDshHost } from '../support/dsh-host.ts';
import { distDir, missingRequirements } from '../support/environment.ts';
import { RecordingTools } from '../support/recording-tools.ts';
import { waitFor } from '../support/wait.ts';

const skip = await missingRequirements({});

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
  const plugin = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
  await started.plugin(plugin, {
    dailyProfile: { userDataDir: join(workDir, 'chrome') },
    dataDir: join(workDir, 'data'),
    connectorSocketPath: join(workDir, 'connector.sock'),
  });
  await started.plugin(await import(pathToFileURL(join(distDir, 'host', 'tools.js')).href));
  await started.plugin(await import(pathToFileURL(join(distDir, 'host', 'context.js')).href));
  await waitFor(
    () => started.get('chrome')?.extensionDir !== undefined,
    5000,
    'the plugin to start',
  );
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

test('starting installs the connector and a native host manifest for the daily profile', {
  skip,
}, async () => {
  const manifest = JSON.parse(
    await readFile(
      join(workDir, 'chrome', 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`),
      'utf8',
    ),
  );
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${CONNECTOR_EXTENSION_ID}/`]);
  assert.equal(manifest.path, join(workDir, 'data', 'native-host-daily'));
  const extension = JSON.parse(
    await readFile(join(workDir, 'data', 'extension', 'manifest.json'), 'utf8'),
  );
  assert.equal(extension.version, packageJson.version);
});

test('the viewer route refuses requests DSH would not authenticate', { skip }, async () => {
  const origin = `http://127.0.0.1:${port}`;
  assert.equal(await upgradeStatus({ origin }), 401);
  assert.equal(
    await upgradeStatus({ origin: 'https://elsewhere.example', cookie: SIGNED_IN_COOKIE }),
    403,
  );
});

test('a signed-in viewer watches its session and hears why a page cannot open', {
  skip,
}, async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${VIEWER_PATH}`, {
    headers: { origin: `http://127.0.0.1:${port}`, cookie: SIGNED_IN_COOKIE },
  });
  const events = eventQueue(socket);
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  socket.send(JSON.stringify({ type: 'watch', sessionId: 'session-1' }));
  assert.deepEqual(await events.next(), { type: 'pages', pages: [] });
  socket.send(
    JSON.stringify({
      type: 'open',
      url: 'example.com',
      viewport: { width: 400, height: 300, deviceScaleFactor: 1 },
    }),
  );
  const failure = await events.next();
  assert.ok(failure.type === 'failed', JSON.stringify(failure));
  assert.equal(failure.requestType, 'open');
  assert.match(failure.message, /your Chrome is not connected/);
  socket.close();
});

test('the host row finishes starting only once ctx.chrome is available', { skip }, async () => {
  // DSH reports the rows that inject `chrome` (tools, context) as not activated when the
  // service is still starting at the moment the host row counts as started.
  const dir = await mkdtemp(join(tmpdir(), 'dsh-chrome-compat-start-'));
  const separate = await startDshHost();
  try {
    const plugin = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
    await separate.root.plugin(plugin, {
      dailyProfile: { userDataDir: join(dir, 'chrome') },
      dataDir: join(dir, 'data'),
      connectorSocketPath: join(dir, 'connector.sock'),
    });
    assert.notEqual(separate.root.get('chrome'), undefined);
  } finally {
    await separate.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the tools row registers every chrome tool with a valid definition', { skip }, () => {
  const tools = root?.get('tools') as RecordingTools | undefined;
  assert.deepEqual(tools?.registered.map((tool) => tool.name).sort(), [
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

/** The HTTP status a WebSocket upgrade gets back, or 101 when it succeeds. */
function upgradeStatus(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${VIEWER_PATH}`, { headers });
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
