/**
 * The viewer's routes: two WebSockets on the DSH Host for each sidebar tab, one carrying
 * Chrome's screen as VNC and one carrying the tab's requests and state. Both are admitted
 * by the same check as DSH's own `/api`, so any browser signed in to this DSH Host
 * (Desktop or remote) can use them, and nothing else can. The screen socket names its
 * session: the keys it carries go to that session's windows.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { WebSocketServer } from 'ws';
import { SCREEN_PATH, SCREEN_SESSION_PARAMETER, VIEWER_PATH } from '../../protocol/viewer.ts';
import type {} from '../chrome/chrome-service.ts';
import type { Log } from '../platform/log.ts';
import { MAX_CLIENT_MESSAGE_BYTES } from './rfb-client-stream.ts';
import { bridgeScreen } from './screen-bridge.ts';
import { ScreenOwnership } from './screen-ownership.ts';
import { ViewerConnection } from './viewer-connection.ts';

export const name = 'dsh-chrome-viewer';
export const inject = ['chrome', 'webServer', 'connection'];

/** A viewer's requests are small. */
const MAX_VIEWER_MESSAGE_BYTES = 256 * 1024;
/** A viewer's VNC messages carry input, and the clipboard text it pastes. */
const MAX_SCREEN_MESSAGE_BYTES = MAX_CLIENT_MESSAGE_BYTES;

export function apply(ctx: Context): void {
  const log: Log = {
    info: (message) => ctx.logger.info(message),
    warn: (message) => ctx.logger.warn(message),
  };
  const { chrome } = ctx;
  /** Which viewer each session's screen is laid out for, while a viewer shows the session. */
  const ownerships = new Map<string, ScreenOwnership>();
  const ownershipOf = (sessionId: string): ScreenOwnership => {
    let ownership = ownerships.get(sessionId);
    if (ownership === undefined) {
      ownership = new ScreenOwnership(
        async (size) => chrome.sizeSessionScreen(sessionId, size),
        () => chrome.deviceScaleFactor,
        log,
      );
      ownerships.set(sessionId, ownership);
    }
    return ownership;
  };
  // A Chrome started anew may draw at another scale factor: the screens take their owners'
  // sizes at it.
  ctx.effect(
    () =>
      chrome.onStateChange((state) => {
        if (state.kind !== 'running') return;
        for (const ownership of ownerships.values()) ownership.refresh();
      }),
    "dsh-chrome: the sessions' screens at Chrome's scale",
  );
  const ownershipLeft = (sessionId: string): void => {
    if (ownerships.get(sessionId)?.empty) ownerships.delete(sessionId);
  };
  const viewers = new WebSocketServer({ noServer: true, maxPayload: MAX_VIEWER_MESSAGE_BYTES });
  const screens = new WebSocketServer({ noServer: true, maxPayload: MAX_SCREEN_MESSAGE_BYTES });

  /** Answers a request DSH would not admit, as DSH answers one to its `/api`. */
  const refused = (request: IncomingMessage, socket: Duplex): boolean => {
    const rejection = ctx.connection.requestRejection(request);
    if (rejection === undefined) return false;
    const reason = rejection === 401 ? 'Unauthorized' : 'Forbidden';
    socket.end(`HTTP/1.1 ${rejection} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    return true;
  };

  ctx.effect(
    () =>
      ctx.webServer.registerUpgrade({
        path: VIEWER_PATH,
        handler: (request, socket, head) => {
          if (refused(request, socket)) return;
          viewers.handleUpgrade(request, socket, head, (webSocket) => {
            new ViewerConnection(webSocket, { chrome, ownershipOf, ownershipLeft, log });
          });
        },
      }),
    'dsh-chrome: viewer route',
  );

  ctx.effect(
    () =>
      ctx.webServer.registerUpgrade({
        path: SCREEN_PATH,
        handler: (request, socket, head) => {
          if (refused(request, socket)) return;
          const sessionId = new URL(request.url ?? '/', 'http://host').searchParams.get(
            SCREEN_SESSION_PARAMETER,
          );
          if (sessionId === null || sessionId === '') {
            socket.end(
              'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
            );
            return;
          }
          screens.handleUpgrade(request, socket, head, (webSocket) => {
            bridgeScreen(webSocket, {
              sessionId,
              vncSocketPath: chrome.vncSocketPath(),
              keyboard: chrome.keyboard,
              log,
            });
          });
        },
      }),
    'dsh-chrome: screen route',
  );

  ctx.effect(
    () => () => {
      for (const client of [...viewers.clients, ...screens.clients]) client.terminate();
    },
    'dsh-chrome: viewers',
  );
}
