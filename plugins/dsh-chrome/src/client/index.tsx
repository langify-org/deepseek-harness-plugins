/**
 * dsh-chrome's browser client: the Chrome tab type of the right sidebar, and dsh-chrome's
 * page in DSH's plugin settings.
 */
import type { Context } from '@deepseek-ai/cordis';
import packageJson from '../../package.json' with { type: 'json' };
import { HOST_ROW_ID } from '../protocol/settings.ts';
import { screenPath, VIEWER_PATH } from '../protocol/viewer.ts';
import { ChromeTab, type ChromeTabInjected } from './chrome-tab.tsx';
import type {} from './dsh-context.ts';
import { addToMessage } from './message-attachments.ts';
import { SettingsPage, type SettingsPageInjected } from './settings/settings-page.tsx';

export const name = 'dsh-chrome';
export const inject = ['connection', 'slots', 'sidebarRightTabs'];

/** The tab type's identity in the sidebar: the package that implements it. */
const TAB_TYPE_ID = packageJson.name;
const TAB_KIND = 'chrome';
/** The Plugins page's slot for a row's own page, and the key of the host plugin's row there. */
const ROW_CONFIG_SLOT = 'plugins.row.config';
const ROW_CONFIG_KEY = `${packageJson.name}#${HOST_ROW_ID}`;

export function apply(ctx: Context): void {
  const injected: ChromeTabInjected = {
    openViewerSocket: () => ctx.connection.openWebSocket(VIEWER_PATH),
    openScreenSocket: (sessionId) => ctx.connection.openWebSocket(screenPath(sessionId)),
    // The conversation UI is optional: a web client without it has no message to add to.
    addToMessage: (sessionId, files, inputActions) =>
      addToMessage(ctx.get('conversation'), sessionId, files, inputActions),
  };

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_TYPE_ID,
        kind: TAB_KIND,
        // Every Chrome tab shows the one Chrome, so a pane needs one. A tab in the background
        // keeps its connection to dsh-chrome, and leaves only the screen's stream.
        keepMounted: true,
        title: () => 'Chrome',
        guide: [
          {
            id: 'open',
            order: 31,
            title: () => 'Chrome',
            description: () => 'Chrome, shared with the agent',
          },
        ],
      }),
    'dsh-chrome: tab type',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_TYPE_ID, inject: () => injected },
          ChromeTab,
        ),
      ),
    'dsh-chrome: tab body',
  );
  // The Plugins page declares its slots once it loads, with DSH's settings service; a web
  // client without that service has no form to show.
  ctx.effect(
    () =>
      ctx.slots.inject(ROW_CONFIG_SLOT, () => {
        const configForms = ctx.get('configForms');
        if (configForms === undefined) return () => {};
        const settings: SettingsPageInjected = {
          configurations: configForms.describe(),
          resolveText: (text) =>
            ctx.get('locale')?.resolveText(text) ??
            (typeof text === 'string' ? text : (text['en'] ?? '')),
          openViewerSocket: () => ctx.connection.openWebSocket(VIEWER_PATH),
        };
        return ctx.slots.register(
          { name: ROW_CONFIG_SLOT, key: ROW_CONFIG_KEY, inject: () => settings },
          SettingsPage,
        );
      }),
    'dsh-chrome: settings page',
  );
}
