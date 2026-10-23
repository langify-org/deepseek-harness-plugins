/**
 * Client-side DSH services this plugin uses, as `ctx` members.
 *
 * DSH 0.2.1-rc.2 publishes the type of the web client's `ctx.connection` but does not
 * declare it on `Context` (only the Host's connection is declared there), and publishes no
 * types of its settings UI's services, so the client declares what it uses of them here.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { ConfigForm, ConfigurationsSource } from './settings/settings-page.tsx';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The web client's connection to its DSH Host. */
    connection: ConnectionHandle;
    /** The forms of DSH's settings service (dsh-client-ui-settings), with the settings UI. */
    configForms: { describe(): ConfigurationsSource };
    /** The web client's language (dsh-client-locale). */
    locale: { resolveText(text: string | Readonly<Record<string, string>>): string };
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * A row's own page in DSH's Plugins page (dsh-client-ui-plugin-manager), keyed
     * `<package>#<row id>`: its summary in the list, and its page, with the row's settings
     * form while the row runs.
     */
    'plugins.row.config': {
      kind: 'keyed';
      scope: 'root';
      owner: { readonly view: 'page' | 'summary'; readonly form?: ConfigForm | undefined };
    };
  }
}
