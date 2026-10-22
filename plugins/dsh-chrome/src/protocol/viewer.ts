/**
 * Messages between the dsh-chrome host plugin and a viewer: the sidebar tab that shows
 * Chrome's screen in the DSH web client.
 *
 * A viewer holds two WebSockets to the DSH Host. Over the screen socket ({@link SCREEN_PATH})
 * travels the VNC protocol (RFB), byte for byte as Chrome's screen serves it: pixels in,
 * pointer and keys out. Over the viewer socket ({@link VIEWER_PATH}) travel the messages
 * defined here, as JSON text: the screen's size, whether Chrome runs, the agent's requests
 * for the user's help, and what the user asks for besides input.
 *
 * Every viewer shows the same screen, laid out for one of them at a time: the one the user
 * last worked in.
 *
 * This module is shared by the host plugin and the browser client: it uses only APIs
 * that both Node and browsers provide.
 */

/** The viewer socket's path on the DSH Host. */
export const VIEWER_PATH = '/dsh-chrome/viewer';
/** The screen socket's path on the DSH Host: the VNC stream of Chrome's screen. */
export const SCREEN_PATH = '/dsh-chrome/screen';

/** How the user answered the agent's request for help. */
export type HelpAnswer = 'done' | 'declined';

export type ViewerRequest =
  /** Names the viewer's DSH session; the host answers with the state of Chrome and the screen. */
  | { readonly type: 'watch'; readonly sessionId: string }
  /** The size of the viewer's screen area, in CSS pixels; sent on every change. */
  | { readonly type: 'viewport'; readonly width: number; readonly height: number }
  /** The user works in this viewer: the screen is laid out for it. */
  | { readonly type: 'claim-screen' }
  /** Opens a page for the session, in front. */
  | { readonly type: 'open'; readonly url: string }
  /** Starts Chrome, if it is not running: when the tab opens, and when the user asks. */
  | { readonly type: 'start-chrome' }
  /** The user's answer to the agent's request for help. */
  | { readonly type: 'answer-help'; readonly requestId: string; readonly answer: HelpAnswer }
  /** Asks for the text of the page the user is looking at, to add it to the user's message. */
  | { readonly type: 'read-text'; readonly requestId: string };

export type ViewerRequestType = ViewerRequest['type'];

/** Every request type, checked against {@link ViewerRequest} by the compiler. */
const VIEWER_REQUEST_TYPES: Readonly<Record<ViewerRequestType, true>> = {
  watch: true,
  viewport: true,
  'claim-screen': true,
  open: true,
  'start-chrome': true,
  'answer-help': true,
  'read-text': true,
};

/** Whether Chrome runs. */
export type ChromeStatus =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running'; readonly version: string }
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
  /** Whether the screen follows this viewer's size. Sent after `watch` and on every change. */
  | { readonly type: 'screen'; readonly owner: boolean }
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
      const { width, height } = value;
      return isPositive(width) && isPositive(height)
        ? { type: 'viewport', width, height }
        : undefined;
    }
    case 'claim-screen':
      return { type: 'claim-screen' };
    case 'open': {
      const { url } = value;
      return isString(url) ? { type: 'open', url } : undefined;
    }
    case 'start-chrome':
      return { type: 'start-chrome' };
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
      return typeof owner === 'boolean' ? { type: 'screen', owner } : undefined;
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
      const { version } = value;
      return isString(version) ? { kind: 'running', version } : undefined;
    }
    case 'failed': {
      const { message } = value;
      return isString(message) ? { kind: 'failed', message } : undefined;
    }
    default:
      return undefined;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
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

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
