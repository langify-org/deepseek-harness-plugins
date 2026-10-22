/**
 * Tells the agent which Chrome pages its session shares, and which one the user is
 * looking at, when that changes: one short message at the start of a turn.
 *
 * Mounted as its own Loader row (`dsh-chrome-context`), so a profile can turn it off.
 * The last reading per session is kept in memory; after a restart, a session gets one
 * fresh reading.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import { type ContextFormed, createUserMessage } from '@deepseek-ai/dsh-llm';
import type {} from '../chrome/chrome-service.ts';
import { NO_PAGES_READING, renderPagesReading } from './reading.ts';

export const name = 'dsh-chrome-context';
export const inject = ['chrome'];

/** The message source this plugin's readings carry. */
const SOURCE_KIND = 'dsh-chrome';

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-chrome': { readonly kind: 'dsh-chrome' } & ContextFormed;
  }
}

export function apply(ctx: Context): void {
  const { chrome } = ctx;
  const lastReading = new Map<string, string>();

  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next();
      // Read once per turn, at its first step, and only for a turn that has something to do:
      // an empty first step ends the turn, and a reading alone must not start one.
      if (
        decision.kind === 'reject' ||
        signal.aborted ||
        step !== 1 ||
        decision.messages.length === 0
      ) {
        return decision;
      }
      const sessionId = agent.id;
      const pages = chrome.pagesOf(sessionId).map((page) => ({
        id: page.id,
        url: page.url,
        title: page.title,
        shown: chrome.pages.isShown(page.id),
      }));
      const previous = lastReading.get(sessionId);
      const current =
        renderPagesReading(pages) ?? (previous === undefined ? undefined : NO_PAGES_READING);
      if (current === undefined || current === previous) return decision;
      if (current === NO_PAGES_READING) lastReading.delete(sessionId);
      else lastReading.set(sessionId, current);
      return {
        ...decision,
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: current }],
            source: {
              kind: SOURCE_KIND,
              form: 'snapshot',
              sections: [{ name: SOURCE_KIND, text: current }],
            },
          }),
          ...decision.messages,
        ],
      };
    },
    { prepend: true },
  );
}
