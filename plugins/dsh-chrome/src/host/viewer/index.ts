/**
 * The viewer route: a WebSocket on the DSH Host through which sidebar tabs show pages
 * and send the user's input. It is admitted by the same check as DSH's own `/api`, so
 * any browser signed in to this DSH Host (Desktop or remote) can use it, and nothing
 * else can.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-host-webserver';
import { WebSocketServer } from 'ws';
import { VIEWER_PATH } from '../../protocol/viewer.ts';
import type {} from '../chrome/chrome-service.ts';
import type { Log } from '../platform/log.ts';
import { type ScreenOptions, ScreenRegistry } from './page-screen.ts';
import { ViewerConnection } from './viewer-connection.ts';

export const name = 'dsh-chrome-viewer';
export const inject = ['chrome', 'webServer', 'connection'];

export type ViewerConfig = ScreenOptions;

/** Viewer messages are small; frames only flow from the host to the viewer. */
const MAX_VIEWER_MESSAGE_BYTES = 256 * 1024;

export function apply(ctx: Context, config: ViewerConfig): void {
  const log: Log = {
    info: (message) => ctx.logger.info(message),
    warn: (message) => ctx.logger.warn(message),
  };
  const screens = new ScreenRegistry(config, log);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_VIEWER_MESSAGE_BYTES });

  ctx.effect(
    () =>
      ctx.webServer.registerUpgrade({
        path: VIEWER_PATH,
        handler: (request, socket, head) => {
          const rejection = ctx.connection.requestRejection(request);
          if (rejection !== undefined) {
            const reason = rejection === 401 ? 'Unauthorized' : 'Forbidden';
            socket.end(
              `HTTP/1.1 ${rejection} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
            );
            return;
          }
          sockets.handleUpgrade(request, socket, head, (webSocket) => {
            new ViewerConnection(webSocket, { chrome: ctx.chrome, screens, log });
          });
        },
      }),
    'dsh-chrome: viewer route',
  );

  ctx.effect(
    () => () => {
      for (const client of sockets.clients) client.terminate();
      screens.disposeAll();
    },
    'dsh-chrome: viewers',
  );
}
