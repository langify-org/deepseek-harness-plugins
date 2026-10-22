import { randomUUID } from 'node:crypto';
import type { HelpAnswer } from '../../protocol/viewer.ts';
import type { ChromePage, PageId } from './pages/page.ts';

/** How a request for help ended, from the agent's side. */
export type HelpOutcome = HelpAnswer | 'page-ended';

export interface HelpRequest {
  readonly id: string;
  readonly pageId: PageId;
  readonly message: string;
}

interface OpenRequest {
  readonly request: HelpRequest;
  readonly settle: (outcome: HelpOutcome) => void;
}

/**
 * The agent's requests for the user's hands on a page: to sign in, solve a CAPTCHA,
 * unlock a password manager, confirm a payment. The agent waits; the user answers from
 * the viewer showing that page. A page has at most one open request.
 */
export class HelpRequests {
  readonly #open = new Map<PageId, OpenRequest>();
  readonly #listeners = new Set<(pageId: PageId) => void>();

  /**
   * Asks for help on the page and waits for the user's answer.
   * @throws the signal's reason when the agent stops waiting.
   */
  ask(page: ChromePage, message: string, signal: AbortSignal): Promise<HelpOutcome> {
    signal.throwIfAborted();
    if (page.ending !== undefined) return Promise.resolve('page-ended');
    if (this.#open.has(page.id)) {
      return Promise.reject(new Error('this page already has an open request for help'));
    }
    const request: HelpRequest = { id: randomUUID(), pageId: page.id, message };
    return new Promise<HelpOutcome>((resolve, reject) => {
      const finish = () => {
        this.#open.delete(page.id);
        signal.removeEventListener('abort', onAbort);
        stopWatchingPage();
        this.#notify(page.id);
      };
      const onAbort = () => {
        finish();
        reject(signal.reason);
      };
      const stopWatchingPage = page.onEnded(() => {
        finish();
        resolve('page-ended');
      });
      signal.addEventListener('abort', onAbort, { once: true });
      this.#open.set(page.id, {
        request,
        settle: (outcome) => {
          finish();
          resolve(outcome);
        },
      });
      this.#notify(page.id);
    });
  }

  /** The page's open request, if any. */
  current(pageId: PageId): HelpRequest | undefined {
    return this.#open.get(pageId)?.request;
  }

  /** Records the user's answer; returns false when the request is no longer open. */
  answer(pageId: PageId, requestId: string, answer: HelpAnswer): boolean {
    const open = this.#open.get(pageId);
    if (open === undefined || open.request.id !== requestId) return false;
    open.settle(answer);
    return true;
  }

  /** Listens to requests opening and closing, by page. */
  onChange(listener: (pageId: PageId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(pageId: PageId): void {
    for (const listener of this.#listeners) listener(pageId);
  }
}
