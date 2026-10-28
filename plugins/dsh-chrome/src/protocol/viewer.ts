/**
 * Messages between the dsh-chrome host plugin and a viewer: the sidebar tab that shows
 * Chrome's screen in the DSH web client.
 *
 * A viewer holds two WebSockets to the DSH Host. Over the screen socket ({@link screenPath})
 * travels the VNC protocol (RFB), as Chrome's screen serves it: pixels in, pointer and keys
 * out. Over the viewer socket ({@link VIEWER_PATH}) travel the messages defined here, as JSON
 * text: where the session's part of the screen is, whether Chrome runs and the session has a
 * window, the agent's requests for the user's help, and what the user asks for besides input.
 *
 * Each session has its own part of the screen, with its own windows; its viewers show that
 * part only, laid out for one of them at a time: the one the user last worked in.
 *
 * dsh-chrome's page in DSH's plugin settings holds a viewer socket too, without watching a
 * session, to copy a profile of the user's own Chrome.
 *
 * This module is shared by the host plugin and the browser client: it uses only APIs
 * that both Node and browsers provide.
 */

/** The viewer socket's path on the DSH Host. */
export const VIEWER_PATH = '/dsh-chrome/viewer';
/** The screen socket's path on the DSH Host: the VNC stream of Chrome's screen. */
export const SCREEN_PATH = '/dsh-chrome/screen';
/** The query parameter of the screen socket that names the viewer's DSH session. */
export const SCREEN_SESSION_PARAMETER = 'session';

/** The screen socket's path for a session's viewer: the keys it carries go to the session. */
export function screenPath(sessionId: string): string {
  return `${SCREEN_PATH}?${SCREEN_SESSION_PARAMETER}=${encodeURIComponent(sessionId)}`;
}

/** The session's part of the screen, in the screen's pixels. */
export interface ScreenRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How the user answered the agent's request for help. */
export type HelpAnswer = 'done' | 'declined';

export type ViewerRequest =
  /** Names the viewer's DSH session; the host answers with the state of Chrome and the screen. */
  | { readonly type: 'watch'; readonly sessionId: string }
  /**
   * The size of the viewer's screen area, in CSS pixels, and the pixel ratio of the display it
   * is on; sent on every change, and before `watch` once known.
   */
  | {
      readonly type: 'viewport';
      readonly width: number;
      readonly height: number;
      readonly devicePixelRatio: number;
    }
  /** The user works in this viewer: the screen is laid out for it. */
  | { readonly type: 'claim-screen' }
  /** Opens a page for the session, in front. */
  | { readonly type: 'open'; readonly url: string }
  /**
   * Shows the session's window, opening one, and starting Chrome, if need be: when the tab
   * opens, and when the user asks.
   */
  | { readonly type: 'open-window' }
  /** Closes Chrome and starts it again, for changed settings to apply. */
  | { readonly type: 'restart-chrome' }
  /** The user's answer to the agent's request for help. */
  | { readonly type: 'answer-help'; readonly requestId: string; readonly answer: HelpAnswer }
  /** Asks for the text of the page the user is looking at, to add it to the user's message. */
  | { readonly type: 'read-text'; readonly requestId: string }
  /** Asks which profiles the user's own Chrome has. */
  | { readonly type: 'user-chrome' }
  /**
   * Replaces dsh-chrome's profile with a copy of a profile of the user's own Chrome, closing
   * Chrome's windows.
   */
  | { readonly type: 'copy-profile'; readonly directory: string };

export type ViewerRequestType = ViewerRequest['type'];

/** Every request type, checked against {@link ViewerRequest} by the compiler. */
const VIEWER_REQUEST_TYPES: Readonly<Record<ViewerRequestType, true>> = {
  watch: true,
  viewport: true,
  'claim-screen': true,
  open: true,
  'open-window': true,
  'restart-chrome': true,
  'answer-help': true,
  'read-text': true,
  'user-chrome': true,
  'copy-profile': true,
};

/** A profile of the user's own Chrome. */
export interface UserChromeProfileState {
  /** The profile's directory in Chrome's user data directory, which names it in requests. */
  readonly directory: string;
  readonly name: string;
  /** The Google account it is signed in to, if any. */
  readonly account: string | null;
}

/**
 * Where a copy of a profile of the user's Chrome stands. `startedAt`, the host's time in
 * milliseconds since the epoch, tells one copy from another.
 */
export type ProfileCopyStatus = { readonly directory: string; readonly startedAt: number } & (
  | {
      readonly kind: 'copying-files';
      /** The bytes of the files begun so far, and of all the copy takes. */
      readonly copiedBytes: number;
      readonly totalBytes: number;
    }
  | {
      readonly kind: 'checking-databases';
      /** How many of the databases copied are checked whole, of all. */
      readonly checked: number;
      readonly total: number;
    }
  /** Chrome closes, and the copy takes the profile's place. */
  | { readonly kind: 'replacing' }
  | { readonly kind: 'copied' }
  | { readonly kind: 'failed'; readonly message: string }
);

/** Whether Chrome runs. */
export type ChromeStatus =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'running';
      readonly version: string;
      /**
       * Why Chrome would start otherwise now, for this viewer, if it would: the settings changed
       * since it started, or an `auto` scale would draw for this viewer's display at another
       * pixel ratio. Either applies once Chrome starts again.
       */
      readonly restartFor: 'settings' | 'display' | null;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** The agent asks the user to do something on a page, and waits. */
export interface HelpRequestState {
  readonly id: string;
  readonly message: string;
  /** The page, as the user sees it in Chrome's tab strip. */
  readonly pageTitle: string;
  readonly pageUrl: string;
}

export type ViewerEvent =
  /** Whether Chrome runs. Sent after `watch` and on every change. */
  | { readonly type: 'chrome'; readonly status: ChromeStatus }
  /**
   * Where the session's part of the screen is, `null` until it has one, and whether its size
   * follows this viewer's. Sent after `watch` and on every change.
   */
  | { readonly type: 'screen'; readonly owner: boolean; readonly region: ScreenRegion | null }
  /** Whether the session has a window in Chrome. Sent after `watch` and on every change. */
  | { readonly type: 'windows'; readonly open: boolean }
  /** The profiles of the user's own Chrome, and whether it runs: the answer to `user-chrome`. */
  | {
      readonly type: 'user-chrome';
      readonly profiles: readonly UserChromeProfileState[];
      readonly running: boolean;
    }
  /**
   * Where the last copy of a profile since dsh-chrome started stands, under way or ended, or
   * `null` for none: to a viewer that asked for the user's profiles or for a copy, at once, and
   * on every change.
   */
  | { readonly type: 'profile-copy'; readonly copy: ProfileCopyStatus | null }
  /** The session's open request for help, or `null` when there is none. */
  | { readonly type: 'help'; readonly request: HelpRequestState | null }
  | {
      readonly type: 'page-text';
      readonly requestId: string;
      readonly title: string;
      readonly url: string;
      readonly text: string;
    }
  /**
   * The host could not carry out a request. A viewer that waits for an answer to it (a
   * page's text) learns from `requestType` and `requestId` that none will come.
   */
  | {
      readonly type: 'failed';
      /** The failed request's type, or `null` when the host could not read the request. */
      readonly requestType: ViewerRequestType | null;
      /** The failed request's `requestId`, for the requests that carry one. */
      readonly requestId: string | null;
      readonly message: string;
    };

// Validation. Each side parses what it receives into fresh values: the peer is another
// process, and fields this protocol does not define are dropped.

export function decodeViewerRequest(text: string): ViewerRequest | undefined {
  return parseViewerRequest(safeJson(text));
}

export function decodeViewerEvent(text: string): ViewerEvent | undefined {
  return parseViewerEvent(safeJson(text));
}

export function parseViewerRequest(value: unknown): ViewerRequest | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'watch': {
      const { sessionId } = value;
      return isString(sessionId) ? { type: 'watch', sessionId } : undefined;
    }
    case 'viewport': {
      const { width, height, devicePixelRatio } = value;
      return isPositive(width) && isPositive(height) && isPositive(devicePixelRatio)
        ? { type: 'viewport', width, height, devicePixelRatio }
        : undefined;
    }
    case 'claim-screen':
      return { type: 'claim-screen' };
    case 'open': {
      const { url } = value;
      return isString(url) ? { type: 'open', url } : undefined;
    }
    case 'open-window':
      return { type: 'open-window' };
    case 'restart-chrome':
      return { type: 'restart-chrome' };
    case 'answer-help': {
      const { requestId, answer } = value;
      return isString(requestId) && (answer === 'done' || answer === 'declined')
        ? { type: 'answer-help', requestId, answer }
        : undefined;
    }
    case 'read-text': {
      const { requestId } = value;
      return isString(requestId) ? { type: 'read-text', requestId } : undefined;
    }
    case 'user-chrome':
      return { type: 'user-chrome' };
    case 'copy-profile': {
      const { directory } = value;
      return isString(directory) ? { type: 'copy-profile', directory } : undefined;
    }
    default:
      return undefined;
  }
}

export function parseViewerEvent(value: unknown): ViewerEvent | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'chrome': {
      const status = parseChromeStatus(value['status']);
      return status === undefined ? undefined : { type: 'chrome', status };
    }
    case 'screen': {
      const { owner } = value;
      const region = value['region'] === null ? null : parseRegion(value['region']);
      return typeof owner === 'boolean' && region !== undefined
        ? { type: 'screen', owner, region }
        : undefined;
    }
    case 'windows': {
      const { open } = value;
      return typeof open === 'boolean' ? { type: 'windows', open } : undefined;
    }
    case 'user-chrome': {
      const { profiles, running } = value;
      if (!Array.isArray(profiles) || typeof running !== 'boolean') return undefined;
      const parsed = profiles.map(parseProfile);
      return parsed.every((profile) => profile !== undefined)
        ? { type: 'user-chrome', profiles: parsed as UserChromeProfileState[], running }
        : undefined;
    }
    case 'profile-copy': {
      if (value['copy'] === null) return { type: 'profile-copy', copy: null };
      const copy = parseCopyStatus(value['copy']);
      return copy === undefined ? undefined : { type: 'profile-copy', copy };
    }
    case 'help': {
      const { request } = value;
      if (request === null) return { type: 'help', request: null };
      if (!isRecord(request)) return undefined;
      const { id, message, pageTitle, pageUrl } = request;
      return isString(id) && isString(message) && isString(pageTitle) && isString(pageUrl)
        ? { type: 'help', request: { id, message, pageTitle, pageUrl } }
        : undefined;
    }
    case 'page-text': {
      const { requestId, title, url, text } = value;
      return isString(requestId) && isString(title) && isString(url) && isString(text)
        ? { type: 'page-text', requestId, title, url, text }
        : undefined;
    }
    case 'failed': {
      const { requestType, requestId, message } = value;
      return (requestType === null || isRequestType(requestType)) &&
        (requestId === null || isString(requestId)) &&
        isString(message)
        ? { type: 'failed', requestType, requestId, message }
        : undefined;
    }
    default:
      return undefined;
  }
}

function parseChromeStatus(value: unknown): ChromeStatus | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['kind']) {
    case 'stopped':
      return { kind: 'stopped' };
    case 'starting':
      return { kind: 'starting' };
    case 'running': {
      const { version, restartFor } = value;
      return isString(version) &&
        (restartFor === null || restartFor === 'settings' || restartFor === 'display')
        ? { kind: 'running', version, restartFor }
        : undefined;
    }
    case 'failed': {
      const { message } = value;
      return isString(message) ? { kind: 'failed', message } : undefined;
    }
    default:
      return undefined;
  }
}

function parseProfile(value: unknown): UserChromeProfileState | undefined {
  if (!isRecord(value)) return undefined;
  const { directory, name, account } = value;
  return isString(directory) && isString(name) && (account === null || isString(account))
    ? { directory, name, account }
    : undefined;
}

function parseRegion(value: unknown): ScreenRegion | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height } = value;
  return isCount(x) && isCount(y) && isPositive(width) && isPositive(height)
    ? { x, y, width, height }
    : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseCopyStatus(value: unknown): ProfileCopyStatus | undefined {
  if (!isRecord(value)) return undefined;
  const { directory, startedAt } = value;
  if (!isString(directory) || !isCount(startedAt)) return undefined;
  switch (value['kind']) {
    case 'copying-files': {
      const { copiedBytes, totalBytes } = value;
      return isCount(copiedBytes) && isCount(totalBytes)
        ? { kind: 'copying-files', directory, startedAt, copiedBytes, totalBytes }
        : undefined;
    }
    case 'checking-databases': {
      const { checked, total } = value;
      return isCount(checked) && isCount(total) && checked <= total
        ? { kind: 'checking-databases', directory, startedAt, checked, total }
        : undefined;
    }
    case 'replacing':
    case 'copied':
      return { kind: value['kind'], directory, startedAt };
    case 'failed':
      return isString(value['message'])
        ? { kind: 'failed', directory, startedAt, message: value['message'] }
        : undefined;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequestType(value: unknown): value is ViewerRequestType {
  return typeof value === 'string' && Object.hasOwn(VIEWER_REQUEST_TYPES, value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
