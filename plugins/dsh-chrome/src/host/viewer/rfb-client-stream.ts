/**
 * The messages a VNC viewer sends, cut from its byte stream (RFC 6143 section 7.5, and the
 * extensions noVNC uses): the bridge needs to know which of them are keys, and which would
 * change the screen's layout. The stream starts with the viewer's half of the handshake.
 */
export type ClientMessage =
  | { readonly kind: 'handshake'; readonly bytes: Buffer }
  | { readonly kind: 'key'; readonly bytes: Buffer }
  | { readonly kind: 'set-desktop-size'; readonly bytes: Buffer }
  | { readonly kind: 'other'; readonly bytes: Buffer };

// Message types a viewer sends.
const SET_PIXEL_FORMAT = 0;
const SET_ENCODINGS = 2;
const FRAMEBUFFER_UPDATE_REQUEST = 3;
const KEY_EVENT = 4;
const POINTER_EVENT = 5;
const CLIENT_CUT_TEXT = 6;
const ENABLE_CONTINUOUS_UPDATES = 150;
const CLIENT_FENCE = 248;
const XVP = 250;
const SET_DESKTOP_SIZE = 251;
const QEMU = 255;
const QEMU_EXTENDED_KEY_EVENT = 0;
/** In a pointer event, the bit that says an extra byte of buttons follows. */
const EXTENDED_POINTER_MARKER = 0x80;
/** The version message: `RFB xxx.yyy\n`. */
const VERSION_BYTES = 12;
/** The longest message a viewer may send: clipboard text the user pastes is the longest. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024 * 1024;

/**
 * Cuts a viewer's byte stream into its messages, as they arrive in pieces: the handshake
 * first, then one message at a time. The handshake is a dialogue, each of the viewer's steps
 * answering the server's: the version, the security type (from version 3.7; for the security
 * type None the screen offers, nothing follows it) and ClientInit, each a message of its own.
 */
export class ClientStream {
  #buffered: Buffer = Buffer.alloc(0);
  /** The lengths of the handshake's steps after the version, once the version says them. */
  #handshakeSteps: number[] | undefined;
  #handshakeDone = false;

  /**
   * Takes the next bytes, and returns the messages they complete.
   * @throws when the bytes are not a message a viewer sends.
   */
  push(chunk: Buffer): ClientMessage[] {
    this.#buffered = this.#buffered.length === 0 ? chunk : Buffer.concat([this.#buffered, chunk]);
    const messages: ClientMessage[] = [];
    for (;;) {
      const message = this.#next();
      if (message === undefined) return messages;
      messages.push(message);
    }
  }

  #next(): ClientMessage | undefined {
    if (!this.#handshakeDone) return this.#handshake();
    const length = messageLength(this.#buffered);
    if (length !== undefined && length > MAX_CLIENT_MESSAGE_BYTES) {
      throw new Error(`the viewer sent a message of ${length} bytes, more than a viewer sends`);
    }
    if (length === undefined || this.#buffered.length < length) return undefined;
    const bytes = this.#take(length);
    const type = bytes[0];
    if (type === KEY_EVENT || (type === QEMU && bytes[1] === QEMU_EXTENDED_KEY_EVENT)) {
      return { kind: 'key', bytes };
    }
    if (type === SET_DESKTOP_SIZE) return { kind: 'set-desktop-size', bytes };
    return { kind: 'other', bytes };
  }

  #handshake(): ClientMessage | undefined {
    const steps = this.#handshakeSteps;
    if (steps === undefined) {
      if (this.#buffered.length < VERSION_BYTES) return undefined;
      const version = this.#buffered.subarray(0, VERSION_BYTES).toString('latin1');
      if (!/^RFB \d{3}\.\d{3}\n$/.test(version)) {
        throw new Error(`the viewer did not start with a VNC version: ${JSON.stringify(version)}`);
      }
      // Version 3.3 has the server pick the security type; later ones have the viewer send it.
      this.#handshakeSteps = version === 'RFB 003.003\n' ? [1] : [1, 1];
      return { kind: 'handshake', bytes: this.#take(VERSION_BYTES) };
    }
    const step = steps[0] as number;
    if (this.#buffered.length < step) return undefined;
    steps.shift();
    if (steps.length === 0) this.#handshakeDone = true;
    return { kind: 'handshake', bytes: this.#take(step) };
  }

  #take(length: number): Buffer {
    const bytes = this.#buffered.subarray(0, length);
    this.#buffered = this.#buffered.subarray(length);
    return bytes;
  }
}

/**
 * The length of the message the bytes start with, or undefined while too few bytes have come
 * to tell.
 * @throws when the message is not one a viewer sends.
 */
function messageLength(bytes: Buffer): number | undefined {
  if (bytes.length < 1) return undefined;
  const type = bytes[0] as number;
  const needs = (count: number) => bytes.length >= count;
  switch (type) {
    case SET_PIXEL_FORMAT:
      return 20;
    case SET_ENCODINGS:
      return needs(4) ? 4 + 4 * bytes.readUInt16BE(2) : undefined;
    case FRAMEBUFFER_UPDATE_REQUEST:
      return 10;
    case KEY_EVENT:
      return 8;
    case POINTER_EVENT:
      return needs(2)
        ? ((bytes[1] as number) & EXTENDED_POINTER_MARKER) !== 0
          ? 7
          : 6
        : undefined;
    case CLIENT_CUT_TEXT:
      // A negative length marks the extended clipboard format; its size is the same.
      return needs(8) ? 8 + Math.abs(bytes.readInt32BE(4)) : undefined;
    case ENABLE_CONTINUOUS_UPDATES:
      return 10;
    case CLIENT_FENCE:
      return needs(9) ? 9 + (bytes[8] as number) : undefined;
    case XVP:
      return 4;
    case SET_DESKTOP_SIZE:
      return needs(8) ? 8 + 16 * (bytes[6] as number) : undefined;
    case QEMU:
      if (!needs(2)) return undefined;
      if (bytes[1] === QEMU_EXTENDED_KEY_EVENT) return 12;
      throw new Error(`the viewer sent a QEMU message this bridge does not know: ${bytes[1]}`);
    default:
      throw new Error(`the viewer sent a message this bridge does not know: type ${type}`);
  }
}
