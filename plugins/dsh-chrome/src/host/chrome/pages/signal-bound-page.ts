import type {
  CdpArgs,
  CdpCommand,
  CdpEventName,
  CdpEventParams,
  CdpResult,
} from '../cdp/cdp-methods.ts';
import type {
  ChromePage,
  PageDialog,
  PageEnding,
  PageId,
  PageOpener,
  RequestOptions,
} from './page.ts';

/**
 * The page as one operation sees it: every command it sends ends when the signal aborts,
 * as a tool call's commands end when the call is stopped. Everything else is the page's.
 */
export function boundToSignal(page: ChromePage, signal: AbortSignal): ChromePage {
  return new SignalBoundPage(page, signal);
}

class SignalBoundPage implements ChromePage {
  readonly #page: ChromePage;
  readonly #signal: AbortSignal;

  constructor(page: ChromePage, signal: AbortSignal) {
    this.#page = page;
    this.#signal = signal;
  }

  get id(): PageId {
    return this.#page.id;
  }

  get targetId(): string {
    return this.#page.targetId;
  }

  get sessionId(): string | undefined {
    return this.#page.sessionId;
  }

  get openedBy(): PageOpener {
    return this.#page.openedBy;
  }

  get openerId(): PageId | undefined {
    return this.#page.openerId;
  }

  get url(): string {
    return this.#page.url;
  }

  get title(): string {
    return this.#page.title;
  }

  get dialog(): PageDialog | undefined {
    return this.#page.dialog;
  }

  get ending(): PageEnding | undefined {
    return this.#page.ending;
  }

  send<M extends CdpCommand>(
    method: M,
    ...[params, options]: CdpArgs<M, RequestOptions>
  ): Promise<CdpResult<M>> {
    const signal =
      options?.signal === undefined
        ? this.#signal
        : AbortSignal.any([options.signal, this.#signal]);
    // The same arguments with the signal added; TypeScript cannot follow the tuple through.
    const args = [params, { ...options, signal }] as unknown as CdpArgs<M, RequestOptions>;
    return this.#page.send(method, ...args);
  }

  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void {
    return this.#page.on(event, listener);
  }

  onChanged(listener: (page: ChromePage) => void): () => void {
    return this.#page.onChanged(listener);
  }

  onEnded(listener: (ending: PageEnding) => void): () => void {
    return this.#page.onEnded(listener);
  }

  bringToFront(): Promise<void> {
    return this.#page.bringToFront();
  }

  close(): Promise<void> {
    return this.#page.close();
  }
}
