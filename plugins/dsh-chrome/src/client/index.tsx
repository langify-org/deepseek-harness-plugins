/**
 * dsh-chrome's browser client: the Chrome tab type of the right sidebar.
 */
import type { Context } from '@deepseek-ai/cordis';
import packageJson from '../../package.json' with { type: 'json' };
import { VIEWER_PATH } from '../protocol/viewer.ts';
import { ChromeTab, type ChromeTabInjected } from './chrome-tab.tsx';
import type {} from './dsh-context.ts';
import { addToMessage } from './message-attachments.ts';

export const name = 'dsh-chrome';
export const inject = ['connection', 'slots', 'sidebarRightTabs'];

/** The tab type's identity in the sidebar: the package that implements it. */
const TAB_TYPE_ID = packageJson.name;
const TAB_KIND = 'chrome';

export function apply(ctx: Context): void {
  const injected: ChromeTabInjected = {
    openViewerSocket: () => ctx.connection.openWebSocket(VIEWER_PATH),
    // The conversation UI is optional: a web client without it has no message to add to.
    addToMessage: (sessionId, files, inputActions) =>
      addToMessage(ctx.get('conversation'), sessionId, files, inputActions),
  };

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_TYPE_ID,
        kind: TAB_KIND,
        multiple: true,
        // The page keeps its connection while its tab is in the background, and returning
        // to the tab must not reconnect.
        keepMounted: true,
        title: () => 'Chrome',
        guide: [
          {
            id: 'open',
            order: 31,
            title: () => 'Chrome',
            description: () => 'A page in your own Chrome, shared with the agent',
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
}
