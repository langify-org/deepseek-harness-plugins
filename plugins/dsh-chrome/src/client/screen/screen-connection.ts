import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import RFB from '@novnc/novnc';
import type { ScreenRegion } from '../../protocol/viewer.ts';
import { KEYSYM, MODIFIER_KEYSYMS } from './keysyms.ts';
import { typingOf } from './typing.ts';

export type ScreenStatus = 'connecting' | 'connected' | 'disconnected';

export interface ScreenConnectionOptions {
  /** The element noVNC draws the screen into, fitted to its size. */
  readonly target: HTMLElement;
  /** Opens the screen socket: the VNC stream of Chrome's screen. */
  readonly openSocket: () => ConnectionWebSocket;
  readonly onStatus: (status: ScreenStatus) => void;
  /** The screen copied text to its clipboard. */
  readonly onClipboard: (text: string) => void;
}

/** How long to wait before connecting again, by attempt; the last is repeated. */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000];

/**
 * Chrome's screen, drawn by noVNC into the target, scaled to fit it: the screen has the
 * target's size in device pixels when this viewer owns it, so it is drawn pixel for pixel.
 * Pointer input goes to the screen through noVNC; keys and text through {@link press},
 * {@link release} and {@link type}, which the viewer's own input surface calls, so that the
 * user's input method composes text in the viewer.
 *
 * It knows which keys the user holds, by physical key, and lets go of the modifiers among
 * them around text it types or pastes: a character AltGr chose arrives as that character, and
 * a paste is a plain Ctrl+V.
 *
 * While started, it connects, and connects again after the connection drops, waiting a
 * little longer each time.
 */
export class ScreenConnection {
  readonly #options: ScreenConnectionOptions;
  #rfb: RFB | undefined;
  #started = false;
  #attempt = 0;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The keysym each key the user holds pressed on the screen, by physical key. */
  readonly #held = new Map<string, number>();
  /** The session's part of the screen, which the view shows. */
  #region: ScreenRegion | undefined;

  constructor(options: ScreenConnectionOptions) {
    this.#options = options;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#attempt = 0;
    this.#connect();
  }

  /** Shows the session's part of the screen, and asks for its pixels only. */
  setRegion(region: ScreenRegion | undefined): void {
    this.#region = region;
    if (this.#rfb !== undefined) this.#rfb.viewRegion = region ?? null;
  }

  stop(): void {
    this.#started = false;
    clearTimeout(this.#retryTimer);
    this.#rfb?.disconnect();
    this.#rfb = undefined;
    this.#held.clear();
    this.#options.onStatus('disconnected');
  }

  /**
   * Presses the keysym for the physical key, and holds it until {@link release}. The key
   * pressed again (auto-repeat) presses it again; a key that now means another keysym (Shift
   * pressed meanwhile) lets go of the first.
   */
  press(key: string, keysym: number): void {
    const before = this.#held.get(key);
    this.#held.set(key, keysym);
    if (before !== undefined && before !== keysym && !this.#holds(before)) {
      this.#send(before, false);
    }
    this.#send(keysym, true);
  }

  /** Lets go of the physical key, unless another key holds the same keysym (⌘ and Ctrl). */
  release(key: string): void {
    const keysym = this.#held.get(key);
    if (keysym === undefined) return;
    this.#held.delete(key);
    if (!this.#holds(keysym)) this.#send(keysym, false);
  }

  /** Taps a key: pressed and released at once. */
  tap(keysym: number): void {
    this.#send(keysym, true);
    this.#send(keysym, false);
  }

  /** Lets go of every key the user holds, as when the user's focus leaves the view. */
  releaseAll(): void {
    const keysyms = new Set(this.#held.values());
    this.#held.clear();
    for (const keysym of keysyms) this.#send(keysym, false);
  }

  /** Types text, without the modifiers held: pressed as keys, or pasted (see typing.ts). */
  type(text: string): void {
    const typing = typingOf(text);
    if (typing.kind === 'paste') {
      this.paste(typing.text);
      return;
    }
    this.#withoutModifiers(() => {
      for (const keysym of typing.keysyms) this.tap(keysym);
    });
  }

  /**
   * Pastes text: the screen offers it as its clipboard, and Ctrl+V pastes it where Chrome's
   * focus is, the address bar included. Without text, Ctrl+V pastes Chrome's own clipboard.
   */
  paste(text: string): void {
    if (text !== '') this.#rfb?.clipboardPasteFrom(text);
    this.#withoutModifiers(() => {
      this.#send(KEYSYM.ControlLeft, true);
      this.tap(KEYSYM.V);
      this.#send(KEYSYM.ControlLeft, false);
    });
  }

  /** The screen as a PNG image, as this viewer shows it. */
  screenshot(): Promise<Blob> {
    const rfb = this.#rfb;
    if (rfb === undefined) return Promise.reject(new Error('the screen is not connected'));
    return new Promise((resolve, reject) =>
      rfb.toBlob(
        (blob) =>
          blob === null ? reject(new Error('the screen could not be captured')) : resolve(blob),
        'image/png',
      ),
    );
  }

  #holds(keysym: number): boolean {
    for (const held of this.#held.values()) if (held === keysym) return true;
    return false;
  }

  /** Runs the action with the held modifiers let go of, and holds them again after. */
  #withoutModifiers(action: () => void): void {
    const modifiers = [...new Set(this.#held.values())].filter((keysym) =>
      MODIFIER_KEYSYMS.has(keysym),
    );
    for (const keysym of modifiers) this.#send(keysym, false);
    action();
    for (const keysym of modifiers) this.#send(keysym, true);
  }

  #send(keysym: number, down: boolean): void {
    this.#rfb?.sendKey(keysym, null, down);
  }

  #connect(): void {
    this.#options.onStatus('connecting');
    const socket = this.#options.openSocket();
    if (!isBrowserWebSocket(socket)) {
      // Nothing to retry: this client's sockets are of another kind.
      socket.close();
      this.#started = false;
      this.#options.onStatus('disconnected');
      console.warn("dsh-chrome: this DSH client's sockets cannot carry the screen's binary stream");
      return;
    }
    let rfb: RFB;
    try {
      rfb = new RFB(this.#options.target, socket, { shared: true });
    } catch (error) {
      socket.close();
      this.#options.onStatus('disconnected');
      console.warn('dsh-chrome: could not connect to the screen', error);
      this.#retry();
      return;
    }
    this.#rfb = rfb;
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.viewRegion = this.#region ?? null;
    // The host sets the screen's size: in device pixels, for the viewer that owns it.
    rfb.resizeSession = false;
    // The viewer's input surface takes the keys; noVNC's own handling would send scancodes,
    // which the screen would read with its own layout, not the user's.
    rfb.focusOnClick = false;
    rfb.background = '#202124';
    rfb.addEventListener('connect', () => {
      this.#attempt = 0;
      this.#options.onStatus('connected');
    });
    rfb.addEventListener('disconnect', () => {
      if (this.#rfb !== rfb) return;
      this.#rfb = undefined;
      // Xvnc lets go of the keys a viewer held when it leaves.
      this.#held.clear();
      this.#options.onStatus('disconnected');
      this.#retry();
    });
    rfb.addEventListener('clipboard', (event) => this.#options.onClipboard(event.detail.text));
  }

  #retry(): void {
    if (!this.#started) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.#attempt += 1;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      if (this.#started && this.#rfb === undefined) this.#connect();
    }, delay);
  }
}

/**
 * Whether the socket is a browser WebSocket, as noVNC takes it, which carries binary
 * messages. DSH's web client opens its sockets with the browser's own API.
 */
function isBrowserWebSocket(
  socket: ConnectionWebSocket,
): socket is ConnectionWebSocket & WebSocket {
  return typeof WebSocket !== 'undefined' && socket instanceof WebSocket;
}
