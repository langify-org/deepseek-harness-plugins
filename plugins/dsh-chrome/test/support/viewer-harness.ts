import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import { SIGNED_IN_COOKIE } from './dsh-host.ts';
import { distDir } from './environment.ts';

/** Where the harness is served on the test Host. */
export const HARNESS_PATH = '/viewer-harness';

/**
 * A stand-in for the DSH web client, just large enough to run the plugin's built browser
 * module: it loads React, registers the module the way DSH's module loader does, gives the
 * plugin a context with the services it uses, and renders the Chrome tab body for a
 * session. Files added to "the message" are kept on `window.__attached`.
 */
function harnessHtml(packageName: string, sessionId: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>dsh-chrome viewer harness</title>
<style>html, body, #root { margin: 0; width: 100%; height: 100%; font: 14px sans-serif; }</style>
<div id="root"></div>
<script>window.__ModuleLoader__ = { rows: new Map(), load(row) { this.rows.set(row.id, row); } };</script>
<script src="${HARNESS_PATH}/react.js"></script>
<script src="${HARNESS_PATH}/react-dom.js"></script>
<script src="${HARNESS_PATH}/client.js"></script>
<script>
  document.cookie = ${JSON.stringify(`${SIGNED_IN_COOKIE}; path=/`)};
  const jsxRuntime = {
    Fragment: React.Fragment,
    jsx: (type, props, key) => React.createElement(type, key === undefined ? props : { ...props, key }),
  };
  jsxRuntime.jsxs = jsxRuntime.jsx;
  const modules = { react: React, 'react/jsx-runtime': jsxRuntime };
  const plugin = window.__ModuleLoader__.rows.get(${JSON.stringify(packageName)}).factory((id) => {
    if (!(id in modules)) throw new Error('the plugin required ' + id);
    return modules[id];
  });

  window.__attached = [];
  const registered = {};
  const ctx = {
    effect: (create) => create(),
    get: (name) => (name === 'conversation' ? {
      createDrafts: (_sessionId, files) => files.map((file) => {
        window.__attached.push(file);
        return { kind: 'file', id: 'draft-' + window.__attached.length, file };
      }),
    } : undefined),
    connection: {
      openWebSocket: (path) => new WebSocket(new URL(path, location.origin).href.replace(/^http/, 'ws')),
    },
    sidebarRightTabs: { register: (definition) => { registered.tab = definition; return () => {}; } },
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => { registered.body = { options, component }; return () => {}; },
    },
  };
  plugin.apply(ctx);
  window.__registeredTab = { kind: registered.tab.kind, keepMounted: registered.tab.keepMounted };

  const sessionId = ${JSON.stringify(sessionId)};
  const tab = { id: 'tab-1', visible: true, navigation: { address: 'sidebar://chrome', params: undefined, revision: 0 } };
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(registered.body.component, {
      sessionId,
      useTabInfo: () => ({ tab }),
      inputActions: { addAttachments: () => true },
      ...registered.body.options.inject(sessionId),
    }),
  );
</script>`;
}

/** Serves the harness and its scripts on the test Host; returns the route's disposer. */
export function serveViewerHarness(
  webServer: WebServer,
  packageName: string,
  sessionId: string,
): () => void {
  const require = createRequire(import.meta.url);
  const files: Record<string, string> = {
    '/react.js': join(
      dirname(require.resolve('react/package.json')),
      'umd',
      'react.production.min.js',
    ),
    '/react-dom.js': join(
      dirname(require.resolve('react-dom/package.json')),
      'umd',
      'react-dom.production.min.js',
    ),
    '/client.js': join(distDir, 'client.js'),
  };
  return webServer.register({
    kind: 'prefix',
    path: HARNESS_PATH,
    handler: async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://harness.invalid').pathname.slice(
        HARNESS_PATH.length,
      );
      if (path === '' || path === '/') {
        send(response, 'text/html; charset=utf-8', harnessHtml(packageName, sessionId));
        return;
      }
      const file = files[path];
      if (file === undefined) {
        response.writeHead(404).end();
        return;
      }
      send(response, 'text/javascript; charset=utf-8', await readFile(file));
    },
  });
}

function send(response: ServerResponse, contentType: string, body: string | Buffer): void {
  response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' }).end(body);
}
