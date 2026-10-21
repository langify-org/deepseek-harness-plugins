import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  decodeFrame,
  decodeViewerEvent,
  type FrameHeader,
  type ViewerEvent,
  type ViewerRequest,
} from '../../protocol/viewer.ts';

export interface ViewerSocketHandlers {
  readonly onOpen: () => void;
  readonly onEvent: (event: ViewerEvent) => void;
  readonly onFrame: (header: FrameHeader, image: Uint8Array<ArrayBuffer>) => void;
  readonly onClose: () => void;
}

/**
 * The viewer's end of the viewer WebSocket: typed requests out, events and frames in.
 *
 * DSH opens the socket on the right carrier (the Desktop's Host origin, or the page's
 * own origin in a browser); this class only speaks the viewer protocol over it.
 */
export class ViewerSocket {
  readonly #socket: ConnectionWebSocket;

  constructor(socket: ConnectionWebSocket, handlers: ViewerSocketHandlers) {
    this.#socket = socket;
    // Browser sockets deliver binary messages as Blobs unless told otherwise.
    if ('binaryType' in socket) socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => handlers.onOpen());
    socket.addEventListener('close', () => handlers.onClose());
    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') {
        const event = decodeViewerEvent(data);
        if (event !== undefined) handlers.onEvent(event);
        return;
      }
      void binaryOf(data).then((buffer) => {
        const frame = buffer === undefined ? undefined : decodeFrame(buffer);
        if (frame !== undefined) handlers.onFrame(frame.header, frame.image);
      });
    });
  }

  send(request: ViewerRequest): void {
    if (this.#socket.readyState === OPEN) this.#socket.send(JSON.stringify(request));
  }

  close(): void {
    this.#socket.close();
  }
}

const OPEN = 1;

async function binaryOf(data: unknown): Promise<ArrayBuffer | undefined> {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Blob) return data.arrayBuffer();
  return undefined;
}
