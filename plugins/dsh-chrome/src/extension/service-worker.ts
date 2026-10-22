/**
 * The connector's service worker: it links this Chrome profile to the dsh-chrome host
 * plugin through native messaging, and controls the pages the plugin opens here.
 *
 * Chrome delivers events that wake a service worker only to listeners registered while
 * the script first runs, so every listener is registered synchronously below.
 */
import {
  CONNECTOR_PROTOCOL,
  type HelloMessage,
  isConnectorCdpEvent,
  NATIVE_HOST_NAME,
  parseHostMessage,
  requestIdOf,
} from '../protocol/connector.ts';
import { NativePort } from './native-port.ts';
import { OwnedPages } from './owned-pages.ts';
import { answerRequest, invalidRequest } from './requests.ts';

const BROWSER_ID_KEY = 'browserId';
const LABEL_KEY = 'label';
/** The version a host asked this connector to reload to: one attempt per version. */
const RELOAD_ATTEMPT_KEY = 'reloadAttempt';
/** Wakes a worker that Chrome stopped while DSH was away, so that it connects again. */
const RECONNECT_ALARM = 'reconnect';

const pages = new OwnedPages({
  onChanged: (page) => port.send({ type: 'page-changed', page }),
  onEnded: (tabId, reason) => port.send({ type: 'page-ended', tabId, reason }),
  onOpened: (page, openerTabId, foreground) =>
    port.send({ type: 'page-opened', page, openerTabId, foreground }),
});
const restored = pages.restore();

const port: NativePort = new NativePort(NATIVE_HOST_NAME, {
  onOpen: () => {
    void hello().then((message) => port.send(message));
  },
  onMessage: (value) => {
    const message = parseHostMessage(value);
    if (message === undefined) {
      const id = requestIdOf(value);
      if (id !== undefined) port.send(invalidRequest(id));
      return;
    }
    if (message.type === 'welcome') {
      port.confirmHost();
      pages.setVisibleWindows(message.visibleWindows);
      if (message.reloadTo !== null) void reloadTo(message.reloadTo);
      return;
    }
    void restored.then(() => answerRequest(message, pages)).then((response) => port.send(response));
  },
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  // Out-of-process frames arrive as child sessions with a sessionId; the plugin drives
  // the top-level page only.
  if (source.tabId === undefined || source.sessionId !== undefined) return;
  if (pages.owns(source.tabId) && isConnectorCdpEvent(method)) {
    port.send({ type: 'cdp-event', tabId: source.tabId, method, params: params ?? {} });
  }
});

void restored.then(() => port.open());

void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) void restored.then(() => port.open());
});

async function hello(): Promise<HelloMessage> {
  const stored = await chrome.storage.local.get([BROWSER_ID_KEY, LABEL_KEY]);
  const label = stored[LABEL_KEY];
  return {
    type: 'hello',
    protocol: CONNECTOR_PROTOCOL,
    browserId: await browserIdFrom(stored[BROWSER_ID_KEY]),
    label: typeof label === 'string' ? label : 'Chrome',
    extensionVersion: chrome.runtime.getManifest().version,
  };
}

/** The id stored for this Chrome profile, minted on first use. */
async function browserIdFrom(stored: unknown): Promise<string> {
  if (typeof stored === 'string') return stored;
  const minted = crypto.randomUUID();
  await chrome.storage.local.set({ [BROWSER_ID_KEY]: minted });
  return minted;
}

/** Reloads from disk to pick up a newer unpacked connector, once per offered version. */
async function reloadTo(version: string): Promise<void> {
  if (version === chrome.runtime.getManifest().version) return;
  const stored = await chrome.storage.local.get(RELOAD_ATTEMPT_KEY);
  if (stored[RELOAD_ATTEMPT_KEY] === version) return;
  await chrome.storage.local.set({ [RELOAD_ATTEMPT_KEY]: version });
  chrome.runtime.reload();
}
