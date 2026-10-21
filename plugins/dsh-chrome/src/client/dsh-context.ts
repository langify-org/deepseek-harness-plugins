/**
 * Client-side DSH services this plugin uses, as `ctx` members.
 *
 * DSH 0.2.1-rc.2 publishes the type of the web client's `ctx.connection` but does not
 * declare it on `Context` (only the Host's connection is declared there), so the
 * client declares it here.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The web client's connection to its DSH Host. */
    connection: ConnectionHandle;
  }
}
