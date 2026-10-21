/**
 * Messages between the dsh-chrome host plugin and the connector extension.
 *
 * Chrome's native messaging carries each message as UTF-8 JSON behind a 32-bit
 * little-endian length. The native host relays those frames unchanged between Chrome
 * and the plugin's connector socket, so both ends speak the same framing.
 *
 * This module is shared by the host plugin and the extension: it uses no Node or
 * browser APIs.
 */

/** Incremented when either side would misread the other's messages. */
export const CONNECTOR_PROTOCOL = 1;

/**
 * Native messaging host name. Chrome looks up a manifest with this name to start the
 * relay, and starts it only for the extension ids that manifest allows.
 */
export const NATIVE_HOST_NAME = 'io.github.langify_org.dsh_chrome';

/** Chrome drops the connection when a message to the extension exceeds 1 MiB. */
export const MAX_HOST_TO_EXTENSION_BYTES = 1024 * 1024;

/**
 * CDP methods the connector refuses. They read the browser's credential stores,
 * HttpOnly cookies included: no page task needs them, and they would let a
 * compromised host lift the user's sessions.
 */
export const DENIED_CDP_METHODS: ReadonlySet<string> = new Set([
  'Network.getCookies',
  'Network.getAllCookies',
  'Storage.getCookies',
]);

/** A Chrome tab id. It stays valid while that Chrome process runs. */
export type TabId = number;

/** The pages of one DSH session share a group: a Chrome tab group with this key and title. */
export interface PageGroup {
  readonly key: string;
  readonly title: string;
}

/** What the connector reports about a page it owns. */
export interface PageSnapshot {
  readonly tabId: TabId;
  readonly groupKey: string;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
}

/** Requests the host sends, with the result each returns. */
export interface ConnectorMethods {
  /** Opens a tab in the browser's agent window, in the group, and starts controlling it. */
  'page.open': { params: { url: string; group: PageGroup }; result: PageSnapshot };
  /** Stops controlling the page and closes its tab. */
  'page.close': { params: { tabId: TabId }; result: null };
  /** Makes the page the active tab of its window, so that Chrome renders it. */
  'page.activate': { params: { tabId: TabId }; result: null };
  /** Lists the pages the connector owns, so a reconnecting host can adopt them again. */
  'page.list': { params: Record<string, never>; result: { pages: PageSnapshot[] } };
  /** Sends one CDP command to an owned page. */
  'cdp.send': { params: { tabId: TabId; method: string; params: JsonObject }; result: unknown };
}

/** A JSON object, as CDP command parameters are. */
export type JsonObject = { readonly [key: string]: unknown };

export type ConnectorMethod = keyof ConnectorMethods;
export type ConnectorParams<M extends ConnectorMethod> = ConnectorMethods[M]['params'];
export type ConnectorResult<M extends ConnectorMethod> = ConnectorMethods[M]['result'];

export type ConnectorErrorCode =
  | 'invalid-request'
  | 'unknown-method'
  | 'not-owned'
  | 'method-denied'
  | 'chrome-error';

export interface ConnectorError {
  readonly code: ConnectorErrorCode;
  readonly message: string;
}

/** Why a page stopped being controlled. */
export type PageEndReason =
  /** The tab was closed. */
  | 'closed'
  /** The user cancelled debugging from Chrome's infobar. */
  | 'released-by-user';

// Extension → host

export interface HelloMessage {
  readonly type: 'hello';
  readonly protocol: number;
  /** Minted once per Chrome profile, when the connector is first installed there. */
  readonly browserId: string;
  /** Shown to the user to tell connected browsers apart. */
  readonly label: string;
  readonly extensionVersion: string;
}

export type ResponseMessage =
  | { readonly type: 'response'; readonly id: number; readonly ok: true; readonly result: unknown }
  | {
      readonly type: 'response';
      readonly id: number;
      readonly ok: false;
      readonly error: ConnectorError;
    };

export interface CdpEventMessage {
  readonly type: 'cdp-event';
  readonly tabId: TabId;
  readonly method: string;
  readonly params: unknown;
}

export interface PageChangedMessage {
  readonly type: 'page-changed';
  readonly page: PageSnapshot;
}

export interface PageEndedMessage {
  readonly type: 'page-ended';
  readonly tabId: TabId;
  readonly reason: PageEndReason;
}

export type ExtensionMessage =
  | HelloMessage
  | ResponseMessage
  | CdpEventMessage
  | PageChangedMessage
  | PageEndedMessage;

// Relay → host

/**
 * The first frame on a connector socket comes from the relay, before any extension
 * message. It names the profile whose native host manifest started the relay. The
 * host's installer writes that name into the relay's launcher, so an extension cannot
 * claim another profile.
 */
export interface RelayHelloMessage {
  readonly type: 'relay-hello';
  readonly protocol: number;
  readonly profile: string;
}

export function parseRelayHello(value: unknown): RelayHelloMessage | undefined {
  if (!isRecord(value) || value['type'] !== 'relay-hello') return undefined;
  const { protocol, profile } = value;
  return isNumber(protocol) && isString(profile)
    ? { type: 'relay-hello', protocol, profile }
    : undefined;
}

// Host → extension

export interface WelcomeMessage {
  readonly type: 'welcome';
  readonly protocol: number;
  /**
   * The connector version the host ships, when it differs from the running one. An
   * unpacked connector reloads itself from disk to pick it up.
   */
  readonly reloadTo: string | null;
}

export interface RequestMessage<M extends ConnectorMethod> {
  readonly type: 'request';
  readonly id: number;
  readonly method: M;
  readonly params: ConnectorParams<M>;
}

/** Any request, discriminated by `method`. */
export type AnyRequestMessage = { [M in ConnectorMethod]: RequestMessage<M> }[ConnectorMethod];

export type HostMessage = WelcomeMessage | AnyRequestMessage;

// Validation. Each side parses what it receives into fresh values: the peer is another
// process, and fields this protocol does not define are dropped.

export function parseExtensionMessage(value: unknown): ExtensionMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'hello': {
      const { protocol, browserId, label, extensionVersion } = value;
      return isNumber(protocol) &&
        isString(browserId) &&
        isString(label) &&
        isString(extensionVersion)
        ? { type: 'hello', protocol, browserId, label, extensionVersion }
        : undefined;
    }
    case 'response': {
      const { id, ok, result, error } = value;
      if (!isNumber(id)) return undefined;
      if (ok === true) return { type: 'response', id, ok, result };
      const parsedError = parseConnectorError(error);
      return ok === false && parsedError !== undefined
        ? { type: 'response', id, ok, error: parsedError }
        : undefined;
    }
    case 'cdp-event': {
      const { tabId, method, params } = value;
      return isNumber(tabId) && isString(method)
        ? { type: 'cdp-event', tabId, method, params }
        : undefined;
    }
    case 'page-changed': {
      const page = parsePageSnapshot(value['page']);
      return page === undefined ? undefined : { type: 'page-changed', page };
    }
    case 'page-ended': {
      const { tabId, reason } = value;
      return isNumber(tabId) && (reason === 'closed' || reason === 'released-by-user')
        ? { type: 'page-ended', tabId, reason }
        : undefined;
    }
    default:
      return undefined;
  }
}

export function parseHostMessage(value: unknown): HostMessage | undefined {
  if (!isRecord(value)) return undefined;
  const { type, id, method, params } = value;
  if (type === 'welcome') {
    const { protocol, reloadTo } = value;
    return isNumber(protocol) && (reloadTo === null || isString(reloadTo))
      ? { type: 'welcome', protocol, reloadTo }
      : undefined;
  }
  if (type !== 'request' || !isNumber(id) || !isRecord(params)) return undefined;
  switch (method) {
    case 'page.open': {
      const { url, group } = params;
      if (!isString(url) || !isRecord(group)) return undefined;
      const { key, title } = group;
      return isString(key) && isString(title)
        ? { type: 'request', id, method, params: { url, group: { key, title } } }
        : undefined;
    }
    case 'page.close':
    case 'page.activate': {
      const { tabId } = params;
      return isNumber(tabId) ? { type: 'request', id, method, params: { tabId } } : undefined;
    }
    case 'page.list':
      return { type: 'request', id, method, params: {} };
    case 'cdp.send': {
      const { tabId, method: cdpMethod, params: cdpParams } = params;
      return isNumber(tabId) && isString(cdpMethod) && isRecord(cdpParams)
        ? { type: 'request', id, method, params: { tabId, method: cdpMethod, params: cdpParams } }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Reads the result of `page.list`. */
export function parsePageList(value: unknown): PageSnapshot[] | undefined {
  if (!isRecord(value)) return undefined;
  const { pages } = value;
  if (!Array.isArray(pages)) return undefined;
  const parsed = pages.map(parsePageSnapshot);
  return parsed.every((page): page is PageSnapshot => page !== undefined) ? parsed : undefined;
}

/** The id of a request that could not be parsed, so that its sender still gets an answer. */
export function requestIdOf(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const { id } = value;
  return isNumber(id) ? id : undefined;
}

export function parsePageSnapshot(value: unknown): PageSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const { tabId, groupKey, url, title, loading } = value;
  return isNumber(tabId) &&
    isString(groupKey) &&
    isString(url) &&
    isString(title) &&
    typeof loading === 'boolean'
    ? { tabId, groupKey, url, title, loading }
    : undefined;
}

const ERROR_CODES: ReadonlySet<string> = new Set<ConnectorErrorCode>([
  'invalid-request',
  'unknown-method',
  'not-owned',
  'method-denied',
  'chrome-error',
]);

function parseConnectorError(value: unknown): ConnectorError | undefined {
  if (!isRecord(value)) return undefined;
  const { code, message } = value;
  return isErrorCode(code) && isString(message) ? { code, message } : undefined;
}

function isErrorCode(value: unknown): value is ConnectorErrorCode {
  return isString(value) && ERROR_CODES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
