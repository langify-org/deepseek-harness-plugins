import { createConnection, type Socket } from 'node:net';
import type { RawData, WebSocket } from 'ws';
import type { KeyboardFocus } from '../chrome/chrome-service.ts';
import type { Log } from '../platform/log.ts';
import { type ClientMessage, ClientStream } from './rfb-client-stream.ts';

/** Above this many bytes not yet sent to the viewer, the screen is read no further. */
const HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** Below this many, reading resumes. */
const LOW_WATER_BYTES = 1024 * 1024;
/** Above this many of the viewer's messages waiting to be passed on, its socket is read no further. */
const MAX_WAITING_MESSAGES = 256;
/** WebSocket close codes: the endpoint failed; a message of the wrong kind arrived; one broke the protocol. */
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_UNSUPPORTED_DATA = 1003;
const CLOSE_PROTOCOL_ERROR = 1002;

export interface ScreenBridgeOptions {
  /** The viewer's DSH session, whose windows its keys go to. */
  readonly sessionId: string;
  /**
   * Where the screen serves VNC, once it does; its failure closes the viewer's socket with
   * the reason.
   */
  readonly vncSocketPath: Promise<string>;
  readonly keyboard: KeyboardFocus;
  readonly log: Log;
}
/** The longest close reason a WebSocket carries, in bytes. */
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Carries a viewer's VNC stream between its WebSocket and the screen's VNC socket, as
 * websockify does: the socket's bytes to the viewer unchanged, and the viewer's messages to
 * the screen in order. A key goes once the session's window has the keyboard (see
 * {@link KeyboardFocus}), and a change of the screen's layout does not go: the host lays the
 * screen out for every session. A viewer that cannot keep up holds the screen's reading back,
 * rather than the host holding the frames for it. Either side closing closes the other.
 */
export function bridgeScreen(webSocket: WebSocket, options: ScreenBridgeOptions): void {
  const { sessionId, vncSocketPath, keyboard, log } = options;
  let vnc: Socket | undefined;
  let closed = false;
  const stream = new ClientStream();
  /** The viewer's messages not yet passed on, behind a key that waits for the keyboard. */
  let waiting = 0;
  let passing: Promise<void> = Promise.resolve();
  /** Whether the screen's socket takes no more for now. */
  let vncFull = false;
  const readViewer = () => {
    if (!vncFull && waiting < MAX_WAITING_MESSAGES) webSocket.resume();
  };
  const write = (bytes: Buffer) => {
    if (closed || vnc === undefined) return;
    if (!vnc.write(bytes)) {
      vncFull = true;
      webSocket.pause();
    }
  };
  const pass = (message: ClientMessage) => {
    // The host lays the screen out for every session.
    if (message.kind === 'set-desktop-size') return;
    if (waiting === 0 && message.kind !== 'key') {
      write(message.bytes);
      return;
    }
    waiting += 1;
    if (waiting >= MAX_WAITING_MESSAGES) webSocket.pause();
    passing = passing
      .then(() => {
        // A viewer gone takes its waiting keys with it: they would bring its session's window
        // forward for nothing.
        if (closed) return;
        if (message.kind === 'key') return keyboard.deliver(sessionId, () => write(message.bytes));
        write(message.bytes);
        return undefined;
      })
      .finally(() => {
        waiting -= 1;
        readViewer();
      });
  };
  const close = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    vnc?.destroy();
    if (webSocket.readyState === webSocket.OPEN || webSocket.readyState === webSocket.CONNECTING) {
      // A paused socket would not read the viewer's answer to the close, and ws would wait
      // for it until its timeout.
      webSocket.resume();
      webSocket.close(code, reason === undefined ? undefined : closeReason(reason));
    }
  };
  webSocket.on('close', () => close());
  webSocket.on('error', (error) => {
    log.warn(`dsh-chrome: a screen connection failed: ${error.message}`);
    close();
  });
  // The VNC server speaks first; until it does, a viewer has nothing to say.
  webSocket.pause();
  webSocket.on('message', (data: RawData, isBinary: boolean) => {
    if (!isBinary) {
      close(CLOSE_UNSUPPORTED_DATA, 'the screen socket carries binary messages only');
      return;
    }
    let messages: ClientMessage[];
    try {
      messages = stream.push(asBuffer(data));
    } catch (error) {
      close(CLOSE_PROTOCOL_ERROR, error instanceof Error ? error.message : String(error));
      return;
    }
    for (const message of messages) pass(message);
  });

  vncSocketPath.then(
    (path) => {
      if (closed) return;
      const socket = createConnection(path);
      vnc = socket;
      socket.on('connect', () => readViewer());
      socket.on('drain', () => {
        vncFull = false;
        readViewer();
      });
      socket.on('data', (chunk: Buffer) => {
        webSocket.send(chunk, { binary: true }, () => {
          if (socket.isPaused() && webSocket.bufferedAmount < LOW_WATER_BYTES) socket.resume();
        });
        if (webSocket.bufferedAmount > HIGH_WATER_BYTES) socket.pause();
      });
      socket.on('error', (error) => {
        log.warn(`dsh-chrome: the screen's VNC socket failed: ${error.message}`);
        close(CLOSE_INTERNAL_ERROR, `the screen is not available: ${error.message}`);
      });
      socket.on('close', () => close());
    },
    (error: unknown) =>
      close(
        CLOSE_INTERNAL_ERROR,
        `the screen did not start: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );
}

function asBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** The reason, shortened to what a close frame carries without splitting a character. */
function closeReason(reason: string): string {
  let shortened = reason;
  while (Buffer.byteLength(shortened) > MAX_CLOSE_REASON_BYTES) shortened = shortened.slice(0, -1);
  return shortened;
}
