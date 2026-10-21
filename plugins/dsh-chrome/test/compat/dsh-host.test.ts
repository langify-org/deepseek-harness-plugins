/**
 * The built plugin against DSH's own Host packages, at the versions it declares
 * (`engines.dsh`): DSH's compatibility check, a real Cordis context, DSH's web server and
 * connection service admitting the viewer route, and the tools' definitions.
 *
 * Needs a build (`pnpm build`). Everything it writes stays in a temporary directory.
 */
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Context, Service } from '@deepseek-ai/cordis';
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import {
  type ConnectionTrustRequest,
  HostConnectionService,
} from '@deepseek-ai/dsh-client-connection';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import WebSocket from 'ws';
import packageJson from '../../package.json' with { type: 'json' };
import { NATIVE_HOST_NAME } from '../../src/protocol/connector.ts';
import { CONNECTOR_EXTENSION_ID } from '../../src/protocol/connector-identity.ts';
import { decodeViewerEvent, VIEWER_PATH, type ViewerEvent } from '../../src/protocol/viewer.ts';

const distDir = fileURLToPath(new URL('../../dist', import.meta.url));
const built = await access(join(distDir, 'host', 'index.js')).then(
  () => true,
  () => false,
);
const skip = built ? false : 'needs a build: run `pnpm build` first';

/** Stands in for DSH's tool runtime, which needs the whole agent composition. */
class RecordingTools extends Service {
  readonly registered: ToolDefinition[] = [];

  constructor(ctx: Context) {
    super(ctx, 'tools');
  }

  register(definition: ToolDefinition): () => void {
    this.registered.push(definition);
    return () => this.registered.splice(this.registered.indexOf(definition), 1);
  }
}

/**
 * DSH's browser authentication, reduced to the two checks admission makes: a request is
 * signed in when it carries the test cookie. (The real one needs DSH's credential store.)
 */
const browserAuth = {
  isAuthenticated: (request: ConnectionTrustRequest) => headerOf(request, 'cookie') === AUTH_COOKIE,
  authenticateApi: () => undefined,
} as unknown as ConstructorParameters<typeof HostConnectionService>[2];

function headerOf(request: ConnectionTrustRequest, name: string): unknown {
  const { headers } = request;
  return headers instanceof Headers ? headers.get(name) : headers[name];
}

let workDir = '';
let root: Context | undefined;
let port = 0;
const AUTH_COOKIE = 'dsh-test=signed-in';

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-compat-'));
  root = new Context();
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  await root.plugin({
    name: 'test-connection',
    apply: (ctx: Context) => {
      new HostConnectionService(ctx, [], browserAuth);
    },
  });
  await root.plugin(RecordingTools);
  const host = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
  await root.plugin(host, {
    dailyProfile: { userDataDir: join(workDir, 'chrome') },
    dataDir: join(workDir, 'data'),
    connectorSocketPath: join(workDir, 'connector.sock'),
  });
  await root.plugin(await import(pathToFileURL(join(distDir, 'host', 'tools.js')).href));
  await root.plugin(await import(pathToFileURL(join(distDir, 'host', 'context.js')).href));
  await waitFor(() => root?.get('chrome')?.extensionDir !== undefined);
  port = root.webServer.port ?? 0;
});

after(async () => {
  await root?.fiber.dispose();
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
    await upgradeStatus({ origin: 'https://elsewhere.example', cookie: AUTH_COOKIE }),
    403,
  );
});

test('a signed-in viewer watches its session and hears why a page cannot open', {
  skip,
}, async () => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${VIEWER_PATH}`, {
    headers: { origin: `http://127.0.0.1:${port}`, cookie: AUTH_COOKIE },
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
  assert.equal(failure.type, 'failed');
  assert.match(failure.type === 'failed' ? failure.message : '', /your Chrome is not connected/);
  socket.close();
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

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the plugin to start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
