import { randomUUID } from 'node:crypto';
import type { ChromePage, PageId } from './pages/page.ts';

/** How the user answered a request for help. */
export type HelpAnswer = 'done' | 'declined';

/** How a request for help ended, from the agent's side. */
export type HelpOutcome = HelpAnswer | 'page-ended';

export interface HelpRequest {
  readonly id: string;
  readonly pageId: PageId;
  /** The DSH session whose agent asks, and whose sidebar shows the request. */
  readonly sessionId: string;
  readonly message: string;
}

interface OpenRequest {
  readonly request: HelpRequest;
  readonly settle: (outcome: HelpOutcome) => void;
}

/**
 * The agent's requests for the user's hands on a page: to sign in, solve a CAPTCHA,
 * unlock a password manager, confirm a payment. The agent waits; the user answers from a
 * sidebar of the agent's session. A page has at most one open request.
 */
export class HelpRequests {
  readonly #open = new Map<string, OpenRequest>();
  readonly #listeners = new Set<() => void>();

  /**
   * Asks for help on the page and waits for the user's answer.
   * @throws the signal's reason when the agent stops waiting.
   */
  ask(
    page: ChromePage,
    sessionId: string,
    message: string,
    signal: AbortSignal,
  ): Promise<HelpOutcome> {
    signal.throwIfAborted();
    if (page.ending !== undefined) return Promise.resolve('page-ended');
    if ([...this.#open.values()].some(({ request }) => request.pageId === page.id)) {
      return Promise.reject(new Error('this page already has an open request for help'));
    }
    const request: HelpRequest = { id: randomUUID(), pageId: page.id, sessionId, message };
    return new Promise<HelpOutcome>((resolve, reject) => {
      const finish = () => {
        this.#open.delete(request.id);
        signal.removeEventListener('abort', onAbort);
        stopWatchingPage();
        this.#notify();
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
      this.#open.set(request.id, {
        request,
        settle: (outcome) => {
          finish();
          resolve(outcome);
        },
      });
      this.#notify();
    });
  }

  /** The session's latest open request, if it has one. */
  ofSession(sessionId: string): HelpRequest | undefined {
    let latest: HelpRequest | undefined;
    for (const { request } of this.#open.values()) {
      if (request.sessionId === sessionId) latest = request;
    }
    return latest;
  }

  /** Records the user's answer; returns false when the request is no longer open. */
  answer(requestId: string, answer: HelpAnswer): boolean {
    const open = this.#open.get(requestId);
    if (open === undefined) return false;
    open.settle(answer);
    return true;
  }

  /** Listens to requests opening and closing. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}
