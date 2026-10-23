import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import { SIGNED_IN_COOKIE } from './dsh-host.ts';
import { distDir } from './environment.ts';

/** Where the harness is served on the test Host. */
export const HARNESS_PATH = '/viewer-harness';

/** What the settings page gets of DSH's settings service. */
export interface SettingsFixture {
  /** The host plugin's configuration schema, as DSH's settings service serves it. */
  readonly schema: unknown;
  /** The settings in effect: the schema's defaults. */
  readonly defaults: Record<string, unknown>;
}

interface SerializedSchema {
  uid: unknown;
  refs: Record<string, { meta?: Record<string, unknown>; dict?: Record<string, unknown> }>;
}

/**
 * The settings fixture from the BUILT host plugin's real `Config`. DSH's settings service
 * serves only the fields a running plugin may change (the volatile ones), so the schema's
 * root object keeps those alone; reading the real schema keeps the test honest about what
 * the page gets.
 */
export async function readSettingsFixture(): Promise<SettingsFixture> {
  const { Config } = (await import(pathToFileURL(join(distDir, 'host', 'index.js')).href)) as {
    Config: { toJSON(): SerializedSchema } & ((
      value: object,
    ) => Record<string, { get(): unknown }>);
  };
  const schema = Config.toJSON();
  const root = schema.refs[String(schema.uid)];
  if (root?.dict === undefined) throw new Error('the configuration schema is not an object');
  const volatile = Object.entries(root.dict).filter(
    ([, uid]) => schema.refs[String(uid)]?.meta?.['volatile'] === true,
  );
  root.dict = Object.fromEntries(volatile);
  // The volatile settings are read through getters; the form shows their current values.
  const settings = Config({});
  const defaults = Object.fromEntries(
    Object.keys(root.dict).map((key) => [key, settings[key]?.get()]),
  );
  return { schema, defaults };
}

/**
 * A stand-in for the DSH web client, just large enough to run the plugin's built browser
 * module: it loads React, registers the module the way DSH's module loader does, gives the
 * plugin a context with the services it uses, and renders the Chrome tab body for a
 * session (`?session=<id>`, else the default one), or, with `?page=settings`, the plugin's
 * page in the Plugins page, with a fake settings service and a form whose edits are kept on
 * `window.__mutations`. Files added to "the message" are kept on `window.__attached`.
 */
function harnessHtml(packageName: string, sessionId: string, settings: SettingsFixture): string {
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
  window.__mutations = [];
  // Components by slot name: the plugin registers the tab body and its settings page.
  const registered = {};
  const params = new URLSearchParams(location.search);
  const settings = ${JSON.stringify(settings)};
  // One snapshot object, as useSyncExternalStore needs a stable value.
  const served = { view: { namespaces: [{ ns: 'dsh-chrome', schema: settings.schema }] } };
  const configForms = { describe: () => ({ getSnapshot: () => served, subscribe: () => () => {} }) };
  const ctx = {
    effect: (create) => create(),
    get: (name) => {
      if (name === 'configForms') return params.get('page') === 'settings' ? configForms : undefined;
      if (name !== 'conversation') return undefined;
      return {
        createDrafts: (_sessionId, files) => files.map((file) => {
          window.__attached.push(file);
          return { kind: 'file', id: 'draft-' + window.__attached.length, file };
        }),
      };
    },
    connection: {
      openWebSocket: (path) => new WebSocket(new URL(path, location.origin).href.replace(/^http/, 'ws')),
    },
    sidebarRightTabs: { register: (definition) => { registered.tab = definition; return () => {}; } },
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => { registered[options.name] = { options, component }; return () => {}; },
    },
  };
  plugin.apply(ctx);
  window.__registeredTab = { kind: registered.tab.kind, keepMounted: registered.tab.keepMounted };

  const root = ReactDOM.createRoot(document.getElementById('root'));
  if (params.get('page') === 'settings') {
    const row = registered['plugins.row.config'];
    const form = {
      state: { status: 'ready', value: settings.defaults, user: {}, revision: 1, writable: true },
      mutate: async (operations, revision) => {
        window.__mutations.push({ operations, revision });
        return true;
      },
    };
    root.render(React.createElement(row.component, { view: 'page', form, ...row.options.inject() }));
  } else {
    const sessionId = params.get('session') ?? ${JSON.stringify(sessionId)};
    const body = registered['sidebar.right.pane.tab'];
    const tab = { id: 'tab-1', visible: true, navigation: { address: 'sidebar://chrome', params: undefined, revision: 0 } };
    root.render(
      React.createElement(body.component, {
        sessionId,
        useTabInfo: () => ({ tab }),
        inputActions: { addAttachments: () => true },
        ...body.options.inject(sessionId),
      }),
    );
  }
</script>`;
}

/**
 * Serves the harness and its scripts on the test Host; returns the route's disposer.
 * @param sessionId - the session the tab body is for when the URL names none.
 */
export function serveViewerHarness(
  webServer: WebServer,
  packageName: string,
  sessionId: string,
  settings: SettingsFixture,
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
        send(response, 'text/html; charset=utf-8', harnessHtml(packageName, sessionId, settings));
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
