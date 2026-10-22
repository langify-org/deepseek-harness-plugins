import { createConnection, type Socket } from 'node:net';
import type { RawData, WebSocket } from 'ws';
import type { Log } from '../platform/log.ts';

/** Above this many bytes not yet sent to the viewer, the screen is read no further. */
const HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** Below this many, reading resumes. */
const LOW_WATER_BYTES = 1024 * 1024;
/** WebSocket close codes: the endpoint failed; a message of the wrong kind arrived. */
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_UNSUPPORTED_DATA = 1003;
/** The longest close reason a WebSocket carries, in bytes. */
const MAX_CLOSE_REASON_BYTES = 123;

/**
 * Carries a viewer's VNC stream between its WebSocket and the screen's VNC socket, as
 * websockify does: binary messages one way, the socket's bytes the other, unchanged. A
 * viewer that cannot keep up holds the screen's reading back, rather than the host holding
 * the frames for it. Either side closing closes the other.
 *
 * @param vncSocketPath - where the screen serves VNC, once it does; its failure closes the
 * viewer's socket with the reason.
 */
export function bridgeScreen(webSocket: WebSocket, vncSocketPath: Promise<string>, log: Log): void {
  let vnc: Socket | undefined;
  let closed = false;
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
    if (vnc !== undefined && !vnc.write(asBuffer(data))) webSocket.pause();
  });

  vncSocketPath.then(
    (path) => {
      if (closed) return;
      const socket = createConnection(path);
      vnc = socket;
      socket.on('connect', () => webSocket.resume());
      socket.on('drain', () => webSocket.resume());
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
