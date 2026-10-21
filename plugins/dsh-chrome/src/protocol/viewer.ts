/**
 * Messages between the dsh-chrome host plugin and a viewer: the sidebar tab that shows a
 * page in the DSH web client.
 *
 * Requests and state travel as JSON text messages over the viewer WebSocket. Frames
 * travel as binary messages: a 32-bit little-endian header length, a JSON
 * {@link FrameHeader}, then the JPEG image.
 *
 * A viewer first names the DSH session it belongs to (`watch`); it then sees that
 * session's pages, and may show one of them at a time.
 *
 * This module is shared by the host plugin and the browser client: it uses only APIs
 * that both Node and browsers provide.
 */

/** The viewer WebSocket's path on the DSH Host. */
export const VIEWER_PATH = '/dsh-chrome/viewer';

/** The size of the viewer's drawing surface. */
export interface Viewport {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per CSS pixel on the viewer's screen. */
  readonly deviceScaleFactor: number;
}

/** CDP's modifier bit set: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export type Modifiers = number;

export type MouseButton = 'none' | 'left' | 'middle' | 'right';

/**
 * Input from the user, in the page's CSS pixel coordinates. The viewer maps its own
 * coordinates through the size each frame reports.
 */
export type ViewerInput =
  | {
      readonly kind: 'mouse';
      readonly action: 'move' | 'down' | 'up';
      readonly x: number;
      readonly y: number;
      readonly button: MouseButton;
      /** Pressed buttons as a bit set: left 1, right 2, middle 4. */
      readonly buttons: number;
      readonly clickCount: number;
      readonly modifiers: Modifiers;
    }
  | {
      readonly kind: 'wheel';
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers: Modifiers;
    }
  | {
      readonly kind: 'key';
      readonly action: 'down' | 'up';
      /** `KeyboardEvent.key` and `KeyboardEvent.code`. */
      readonly key: string;
      readonly code: string;
      /** Windows virtual key code, which Chrome uses for keyboard shortcuts. */
      readonly keyCode: number;
      /** Text the key types; empty for keys that type nothing. */
      readonly text: string;
      readonly modifiers: Modifiers;
      readonly repeat: boolean;
    }
  | {
      /** Finished text: an IME's committed text, a soft keyboard's word, a paste. */
      readonly kind: 'text';
      readonly text: string;
    };

/** How the user answered the agent's request for help. */
export type HelpAnswer = 'done' | 'declined';

export type ViewerRequest =
  /** Names the viewer's DSH session. The host answers with the session's pages. */
  | { readonly type: 'watch'; readonly sessionId: string }
  /** Opens a new page for the session and shows it. */
  | { readonly type: 'open'; readonly url: string; readonly viewport: Viewport }
  /** Shows one of the session's pages. */
  | { readonly type: 'attach'; readonly pageId: string; readonly viewport: Viewport }
  | { readonly type: 'resize'; readonly viewport: Viewport }
  /** Whether the viewer is on screen; a hidden viewer gets no frames. */
  | { readonly type: 'visibility'; readonly visible: boolean }
  | { readonly type: 'input'; readonly input: ViewerInput }
  | { readonly type: 'navigate'; readonly url: string }
  | { readonly type: 'history'; readonly delta: -1 | 1 }
  | { readonly type: 'reload' }
  /** Closes the shown page's tab. */
  | { readonly type: 'close-page' }
  /** The viewer drew frame `seq`; the host may send the next one. */
  | { readonly type: 'frame-drawn'; readonly seq: number }
  /** The user's answer to the agent's request for help on the shown page. */
  | { readonly type: 'answer-help'; readonly requestId: string; readonly answer: HelpAnswer }
  /** Asks for the shown page's text, to add it to the user's message. */
  | { readonly type: 'read-text'; readonly requestId: string };

export type ViewerRequestType = ViewerRequest['type'];

/** Every request type, checked against {@link ViewerRequest} by the compiler. */
const VIEWER_REQUEST_TYPES: Readonly<Record<ViewerRequestType, true>> = {
  watch: true,
  open: true,
  attach: true,
  resize: true,
  visibility: true,
  input: true,
  navigate: true,
  history: true,
  reload: true,
  'close-page': true,
  'frame-drawn': true,
  'answer-help': true,
  'read-text': true,
};

/** Who opened a page: the agent with its tools, or the user from a viewer. */
export type PageOpener = 'agent' | 'user';

/** What a viewer shows about a page besides its pixels. */
export interface PageState {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** The label of the browser the page lives in. */
  readonly browserLabel: string;
  /** `null` for a page the host adopted from a connector that outlived it. */
  readonly openedBy: PageOpener | null;
}

/** The agent asks the user to do something on the page, and waits. */
export interface HelpRequestState {
  readonly id: string;
  readonly message: string;
}

export type ViewerEvent =
  /** The session's pages, most recently used first. Sent after `watch` and on every change. */
  | { readonly type: 'pages'; readonly pages: readonly PageState[] }
  | { readonly type: 'attached'; readonly page: PageState }
  /** The shown page's address, title or loading state changed. */
  | { readonly type: 'page'; readonly page: PageState }
  | { readonly type: 'ended'; readonly reason: string }
  /** The agent's open request for help on the shown page, or `null` when there is none. */
  | { readonly type: 'help'; readonly request: HelpRequestState | null }
  | {
      readonly type: 'page-text';
      readonly requestId: string;
      readonly title: string;
      readonly url: string;
      readonly text: string;
    }
  /**
   * The host could not carry out a request. A viewer that waits for an answer to it (an
   * open page, a page's text) learns from `requestType` and `requestId` that none will come.
   */
  | {
      readonly type: 'failed';
      /** The failed request's type, or `null` when the host could not read the request. */
      readonly requestType: ViewerRequestType | null;
      /** The failed request's `requestId`, for the requests that carry one. */
      readonly requestId: string | null;
      readonly message: string;
    };

export interface FrameHeader {
  readonly seq: number;
  /** The CSS size of the page area the image shows. */
  readonly width: number;
  readonly height: number;
}

export function encodeFrame(header: FrameHeader, image: Uint8Array): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const frame = new Uint8Array(4 + headerBytes.length + image.length);
  new DataView(frame.buffer).setUint32(0, headerBytes.length, true);
  frame.set(headerBytes, 4);
  frame.set(image, 4 + headerBytes.length);
  return frame;
}

export function decodeFrame(
  frame: ArrayBuffer,
): { readonly header: FrameHeader; readonly image: Uint8Array<ArrayBuffer> } | undefined {
  if (frame.byteLength < 4) return undefined;
  const headerLength = new DataView(frame).getUint32(0, true);
  if (4 + headerLength > frame.byteLength) return undefined;
  const header = parseFrameHeader(
    safeJson(new TextDecoder().decode(new Uint8Array(frame, 4, headerLength))),
  );
  return header === undefined
    ? undefined
    : { header, image: new Uint8Array(frame, 4 + headerLength) };
}

/** Reads a viewer's text message. */
export function decodeViewerRequest(text: string): ViewerRequest | undefined {
  return parseViewerRequest(safeJson(text));
}

/** Reads a host's text message. */
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
    case 'open': {
      const { url } = value;
      const viewport = parseViewport(value['viewport']);
      return isString(url) && viewport !== undefined ? { type: 'open', url, viewport } : undefined;
    }
    case 'attach': {
      const { pageId } = value;
      const viewport = parseViewport(value['viewport']);
      return isString(pageId) && viewport !== undefined
        ? { type: 'attach', pageId, viewport }
        : undefined;
    }
    case 'resize': {
      const viewport = parseViewport(value['viewport']);
      return viewport === undefined ? undefined : { type: 'resize', viewport };
    }
    case 'visibility': {
      const { visible } = value;
      return typeof visible === 'boolean' ? { type: 'visibility', visible } : undefined;
    }
    case 'input': {
      const input = parseViewerInput(value['input']);
      return input === undefined ? undefined : { type: 'input', input };
    }
    case 'navigate': {
      const { url } = value;
      return isString(url) ? { type: 'navigate', url } : undefined;
    }
    case 'history': {
      const { delta } = value;
      return delta === -1 || delta === 1 ? { type: 'history', delta } : undefined;
    }
    case 'reload':
      return { type: 'reload' };
    case 'close-page':
      return { type: 'close-page' };
    case 'frame-drawn': {
      const { seq } = value;
      return isNumber(seq) ? { type: 'frame-drawn', seq } : undefined;
    }
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
    case 'pages': {
      const { pages } = value;
      if (!Array.isArray(pages)) return undefined;
      const parsed = pages.map(parsePageState);
      return parsed.every((page): page is PageState => page !== undefined)
        ? { type: 'pages', pages: parsed }
        : undefined;
    }
    case 'attached': {
      const page = parsePageState(value['page']);
      return page === undefined ? undefined : { type: 'attached', page };
    }
    case 'page': {
      const page = parsePageState(value['page']);
      return page === undefined ? undefined : { type: 'page', page };
    }
    case 'ended': {
      const { reason } = value;
      return isString(reason) ? { type: 'ended', reason } : undefined;
    }
    case 'help': {
      const { request } = value;
      if (request === null) return { type: 'help', request: null };
      if (!isRecord(request)) return undefined;
      const { id, message } = request;
      return isString(id) && isString(message)
        ? { type: 'help', request: { id, message } }
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

function parseViewerInput(value: unknown): ViewerInput | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['kind']) {
    case 'mouse': {
      const { action, x, y, button, buttons, clickCount, modifiers } = value;
      return (action === 'move' || action === 'down' || action === 'up') &&
        isNumber(x) &&
        isNumber(y) &&
        isMouseButton(button) &&
        isNumber(buttons) &&
        isNumber(clickCount) &&
        isNumber(modifiers)
        ? { kind: 'mouse', action, x, y, button, buttons, clickCount, modifiers }
        : undefined;
    }
    case 'wheel': {
      const { x, y, deltaX, deltaY, modifiers } = value;
      return isNumber(x) &&
        isNumber(y) &&
        isNumber(deltaX) &&
        isNumber(deltaY) &&
        isNumber(modifiers)
        ? { kind: 'wheel', x, y, deltaX, deltaY, modifiers }
        : undefined;
    }
    case 'key': {
      const { action, key, code, keyCode, text, modifiers, repeat } = value;
      return (action === 'down' || action === 'up') &&
        isString(key) &&
        isString(code) &&
        isNumber(keyCode) &&
        isString(text) &&
        isNumber(modifiers) &&
        typeof repeat === 'boolean'
        ? { kind: 'key', action, key, code, keyCode, text, modifiers, repeat }
        : undefined;
    }
    case 'text': {
      const { text } = value;
      return isString(text) ? { kind: 'text', text } : undefined;
    }
    default:
      return undefined;
  }
}

function parseViewport(value: unknown): Viewport | undefined {
  if (!isRecord(value)) return undefined;
  const { width, height, deviceScaleFactor } = value;
  return isPositive(width) && isPositive(height) && isPositive(deviceScaleFactor)
    ? { width, height, deviceScaleFactor }
    : undefined;
}

function parsePageState(value: unknown): PageState | undefined {
  if (!isRecord(value)) return undefined;
  const { id, url, title, loading, browserLabel, openedBy } = value;
  return isString(id) &&
    isString(url) &&
    isString(title) &&
    typeof loading === 'boolean' &&
    isString(browserLabel) &&
    (openedBy === 'agent' || openedBy === 'user' || openedBy === null)
    ? { id, url, title, loading, browserLabel, openedBy }
    : undefined;
}

function parseFrameHeader(value: unknown): FrameHeader | undefined {
  if (!isRecord(value)) return undefined;
  const { seq, width, height } = value;
  return isNumber(seq) && isPositive(width) && isPositive(height)
    ? { seq, width, height }
    : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isMouseButton(value: unknown): value is MouseButton {
  return value === 'none' || value === 'left' || value === 'middle' || value === 'right';
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

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isNumber(value) && value > 0;
}
