import { Context } from '@deepseek-ai/cordis';
import {
  type ConnectionTrustRequest,
  HostConnectionService,
} from '@deepseek-ai/dsh-client-connection';
import { WebServer } from '@deepseek-ai/dsh-host-webserver';

/** The cookie that signs a test browser in to the test Host. */
export const SIGNED_IN_COOKIE = 'dsh-test=signed-in';

/**
 * DSH's browser authentication, reduced to the two checks admission makes: a request is
 * signed in when it carries the test cookie. (The real one needs DSH's credential store.)
 */
const browserAuth = {
  isAuthenticated: (request: ConnectionTrustRequest) =>
    headerOf(request, 'cookie') === SIGNED_IN_COOKIE,
  authenticateApi: () => undefined,
} as unknown as ConstructorParameters<typeof HostConnectionService>[2];

export interface DshHost {
  readonly root: Context;
  /** The web server's origin, such as `http://127.0.0.1:41234`. */
  readonly origin: string;
  dispose(): Promise<void>;
}

/**
 * A DSH Host composition for tests: DSH's own web server on a loopback port, and DSH's
 * connection service admitting browsers the way it admits `/api` requests.
 */
export async function startDshHost(): Promise<DshHost> {
  const root = new Context();
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 });
  await root.plugin({
    name: 'test-connection',
    apply: (ctx: Context) => {
      new HostConnectionService(ctx, [], browserAuth);
    },
  });
  return {
    root,
    origin: `http://127.0.0.1:${root.webServer.port}`,
    dispose: async () => {
      await root.fiber.dispose();
    },
  };
}

function headerOf(request: ConnectionTrustRequest, name: string): unknown {
  const { headers } = request;
  return headers instanceof Headers ? headers.get(name) : headers[name];
}
