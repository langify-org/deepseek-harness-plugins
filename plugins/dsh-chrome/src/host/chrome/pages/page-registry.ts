import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Protocol } from 'devtools-protocol';
import type { CdpConnection } from '../cdp/cdp-connection.ts';
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

/** A page opened another: a popup, or a link's new tab. */
export interface PageOpening {
  readonly page: ChromePage;
  readonly opener: ChromePage;
}

/** Whose a page is, and who opened it, as the command that created it says. */
interface Claim {
  readonly sessionId: string;
  readonly openedBy: PageOpener;
}

/** How often, and how many times, bringing a page to the front checks that it has the focus. */
const FOCUS_CHECK_MS = 25;
const FOCUS_CHECKS = 40;
/** How long a page may take to say whether it is in view before it counts as not. */
const VIEW_CHECK_MS = 1000;
/** How long Chrome may take to report the page of a target it created. */
const ADOPTION_TIMEOUT_MS = 10_000;
/** How long Chrome may take to end a page it was asked to close. */
const CLOSE_WAIT_MS = 5000;

class Page implements ChromePage {
  readonly id: PageId;
  readonly targetId: string;
  readonly openerId: PageId | undefined;
  readonly #connection: CdpConnection;
  /** The CDP session Chrome attached for this page. */
  readonly #cdpSession: string;
  #sessionId: string | undefined;
  #openedBy: PageOpener;
  #url: string;
  #title: string;
  #dialog: PageDialog | undefined;
  #ending: PageEnding | undefined;
  readonly #changeListeners = new Set<(page: ChromePage) => void>();
  readonly #endListeners = new Set<(ending: PageEnding) => void>();
  readonly #eventSubscriptions = new Set<() => void>();

  constructor(
    id: PageId,
    target: Protocol.Target.TargetInfo,
    cdpSession: string,
    connection: CdpConnection,
    origin: { sessionId: string | undefined; openedBy: PageOpener; openerId: PageId | undefined },
  ) {
    this.id = id;
    this.targetId = target.targetId;
    this.openerId = origin.openerId;
    this.#connection = connection;
    this.#cdpSession = cdpSession;
    this.#sessionId = origin.sessionId;
    this.#openedBy = origin.openedBy;
    this.#url = target.url;
    this.#title = target.title;
  }

  get cdpSession(): string {
    return this.#cdpSession;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  get openedBy(): PageOpener {
    return this.#openedBy;
  }

  get url(): string {
    return this.#url;
  }

  get title(): string {
    return this.#title;
  }

  get dialog(): PageDialog | undefined {
    return this.#dialog;
  }

  get ending(): PageEnding | undefined {
    return this.#ending;
  }

  send<M extends CdpCommand>(
    method: M,
    ...[params, options]: CdpArgs<M, RequestOptions>
  ): Promise<CdpResult<M>> {
    // The same command, for this page's session; TypeScript cannot follow the tuple through.
    const args = [params, { ...options, sessionId: this.#cdpSession }] as unknown as CdpArgs<
      M,
      RequestOptions
    >;
    return this.#connection.send(method, ...args);
  }

  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void {
    const stop = this.#connection.on(event, (params, sessionId) => {
      if (sessionId === this.#cdpSession) (listener as (params: unknown) => void)(params);
    });
    this.#eventSubscriptions.add(stop);
    return () => {
      stop();
      this.#eventSubscriptions.delete(stop);
    };
  }

  onChanged(listener: (page: ChromePage) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  onEnded(listener: (ending: PageEnding) => void): () => void {
    if (this.#ending !== undefined) {
      listener(this.#ending);
      return () => {};
    }
    this.#endListeners.add(listener);
    return () => this.#endListeners.delete(listener);
  }

  async show(): Promise<void> {
    // Bringing a tab forward brings its window forward too, which takes the keyboard from the
    // window the user may be typing in; a page in view needs neither.
    if ((await this.inView()) !== 'hidden') return;
    await this.#connection.send('Target.activateTarget', { targetId: this.targetId });
  }

  async activate(): Promise<void> {
    await this.#connection.send('Target.activateTarget', { targetId: this.targetId });
  }

  async bringToFront(): Promise<void> {
    await this.activate();
    // The window manager grants the focus after the request; Chrome counts the window as its
    // active one once it has it.
    for (let check = 0; check < FOCUS_CHECKS; check += 1) {
      if ((await this.inView()) === 'focused') return;
      await sleep(FOCUS_CHECK_MS);
    }
  }

  /** Closes the page, and returns once Chrome ended it, or after a while. */
  async close(): Promise<void> {
    if (this.#ending !== undefined) return;
    let stopWaiting = () => {};
    const ended = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, CLOSE_WAIT_MS);
      const stop = this.onEnded(() => resolve());
      stopWaiting = () => {
        clearTimeout(timer);
        stop();
      };
    });
    try {
      await this.#connection.send('Target.closeTarget', { targetId: this.targetId });
      await ended;
    } finally {
      stopWaiting();
    }
  }

  /**
   * Whether Chrome shows the page: in its window's front with the focus, in front, or not.
   * The page is asked in a world of dsh-chrome's own, whose `document` the page's scripts
   * cannot redefine to claim the user's eyes.
   */
  async inView(): Promise<'focused' | 'visible' | 'hidden'> {
    try {
      const { result } = await this.#evaluateInOwnWorld(
        "document.visibilityState !== 'visible' ? 'hidden' : document.hasFocus() ? 'focused' : 'visible'",
      );
      return result.value === 'focused' || result.value === 'visible' ? result.value : 'hidden';
    } catch {
      // A page that does not answer, because it shows a dialog or is closing, is not looked at.
      return 'hidden';
    }
  }

  /** The world of dsh-chrome's own in the page's document, once made; a navigation ends it. */
  #ownWorld: number | undefined;

  async #evaluateInOwnWorld(expression: string) {
    const evaluate = (contextId: number) =>
      this.send(
        'Runtime.evaluate',
        { expression, contextId, returnByValue: true },
        { timeoutMs: VIEW_CHECK_MS },
      );
    if (this.#ownWorld !== undefined) {
      try {
        return await evaluate(this.#ownWorld);
      } catch {
        // The document it was made in is gone: make one in this one.
        this.#ownWorld = undefined;
      }
    }
    const { executionContextId } = await this.send(
      'Page.createIsolatedWorld',
      { frameId: this.targetId, worldName: 'dsh-chrome' },
      { timeoutMs: VIEW_CHECK_MS },
    );
    this.#ownWorld = executionContextId;
    return evaluate(executionContextId);
  }

  /** Takes the target's address and title; says whether they changed. */
  update(target: Protocol.Target.TargetInfo): boolean {
    if (target.url === this.#url && target.title === this.#title) return false;
    this.#url = target.url;
    this.#title = target.title;
    this.#changed();
    return true;
  }

  updateDialog(dialog: PageDialog | undefined): void {
    this.#dialog = dialog;
    this.#changed();
  }

  /** Gives the page to a session, unless it already belongs to one; says whether it did. */
  claim({ sessionId, openedBy }: Claim): boolean {
    if (this.#sessionId !== undefined) return false;
    this.#sessionId = sessionId;
    this.#openedBy = openedBy;
    this.#changed();
    return true;
  }

  end(ending: PageEnding): void {
    if (this.#ending !== undefined) return;
    this.#ending = ending;
    for (const stop of this.#eventSubscriptions) stop();
    this.#eventSubscriptions.clear();
    for (const listener of [...this.#endListeners]) listener(ending);
    this.#endListeners.clear();
    this.#changeListeners.clear();
  }

  #changed(): void {
    for (const listener of [...this.#changeListeners]) listener(this);
  }
}

/** Which session's screen the window of a page is on. */
export type SessionOfTarget = (targetId: string) => Promise<string | undefined>;

/**
 * The pages of the Chrome dsh-chrome runs, as they come and go, with the sessions they
 * belong to and the dialogs they show. It follows Chrome's page targets over the CDP
 * connection: Chrome attaches a session for each, through which the page is operated, and
 * reports each end and each change of address. Chrome does not report every change of a
 * title, so titles are brought up to date when they are about to be shown ({@link refresh}).
 *
 * Chrome holds each new page at its start until the registry follows its dialogs, then lets
 * it run. A page that opens at once with a dialog is thus not missed; and Chrome, which
 * otherwise stalls a page that a click opens in a window of its own, together with the input
 * that made the click, goes on.
 */
export class PageRegistry {
  /** The connection of the browser whose pages these are, while it is open. */
  #connection: CdpConnection | undefined;
  readonly #pages = new Map<PageId, Page>();
  readonly #byTarget = new Map<string, Page>();
  readonly #byCdpSession = new Map<string, Page>();
  /** Claims for targets Chrome has not reported yet. */
  readonly #claims = new Map<string, Claim>();
  readonly #adoptionWaiters = new Map<string, Set<(page: Page) => void>>();
  readonly #listeners = new Set<() => void>();
  readonly #openingListeners = new Set<(opening: PageOpening) => void>();
  /** The order of last use: a larger number is more recent. */
  readonly #lastUse = new Map<PageId, number>();
  #useCount = 0;
  readonly #sessionOfTarget: SessionOfTarget | undefined;
  /** How many holds keep pages from being placed by their windows; see {@link holdPlacement}. */
  #placementHolds = 0;
  /** The pages that wait for the holds to end, to be placed. */
  readonly #unplaced = new Set<Page>();

  /**
   * @param sessionOfTarget - says whose a page is that no command opened and no page did:
   * one the user opened in a session's window, which is the session's.
   */
  constructor(sessionOfTarget?: SessionOfTarget) {
    this.#sessionOfTarget = sessionOfTarget;
  }

  /**
   * Follows the pages of the browser behind the connection, those it has and those to come,
   * until the connection closes, when they end.
   */
  async track(connection: CdpConnection): Promise<void> {
    this.#connection = connection;
    const stops = [
      connection.on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger }) => {
        if (targetInfo.type === 'page') {
          this.#adopt(connection, targetInfo, sessionId, waitingForDebugger);
        }
      }),
      connection.on('Target.targetInfoChanged', ({ targetInfo }) => {
        if (this.#byTarget.get(targetInfo.targetId)?.update(targetInfo)) this.#notify();
      }),
      connection.on('Target.targetDestroyed', ({ targetId }) => {
        const page = this.#byTarget.get(targetId);
        if (page !== undefined) this.#remove(page, 'closed');
      }),
      connection.on('Target.detachedFromTarget', ({ sessionId }) => {
        const page = this.#byCdpSession.get(sessionId);
        if (page !== undefined) this.#remove(page, 'closed');
      }),
      connection.on('Page.javascriptDialogOpening', (params, sessionId) =>
        this.#dialogChanged(sessionId, dialogOf(params)),
      ),
      connection.on('Page.javascriptDialogClosed', (_params, sessionId) =>
        this.#dialogChanged(sessionId, undefined),
      ),
    ];
    connection.onClose(() => {
      if (this.#connection === connection) this.#connection = undefined;
      for (const stop of stops) stop();
      for (const page of [...this.#pages.values()]) this.#remove(page, 'chrome-stopped');
      this.#claims.clear();
    });
    const pages = [{ type: 'page', exclude: false }];
    await connection.send('Target.setDiscoverTargets', { discover: true, filter: pages });
    await connection.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: pages,
    });
  }

  /**
   * Says whose the page of a target is that a command just created, and who opened it,
   * whether Chrome has reported the target yet or not. A page that already belongs to a
   * session keeps it.
   */
  claim(targetId: string, sessionId: string, openedBy: PageOpener): void {
    const page = this.#byTarget.get(targetId);
    if (page === undefined) this.#claims.set(targetId, { sessionId, openedBy });
    else if (page.claim({ sessionId, openedBy })) this.#notify();
  }

  /** The page of a target, once Chrome reports it. */
  whenAdopted(targetId: string, options: RequestOptions = {}): Promise<ChromePage> {
    const known = this.#byTarget.get(targetId);
    if (known !== undefined) return Promise.resolve(known);
    const { signal, timeoutMs = ADOPTION_TIMEOUT_MS } = options;
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      let waiters = this.#adoptionWaiters.get(targetId);
      if (waiters === undefined) {
        waiters = new Set();
        this.#adoptionWaiters.set(targetId, waiters);
      }
      const settle = () => {
        waiters.delete(adopted);
        if (waiters.size === 0) this.#adoptionWaiters.delete(targetId);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const adopted = (page: Page) => {
        settle();
        resolve(page);
      };
      const onAbort = () => {
        settle();
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        settle();
        reject(new Error(`Chrome did not report the page it opened within ${timeoutMs} ms`));
      }, timeoutMs);
      waiters.add(adopted);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Brings every page's address and title up to date with what Chrome shows. */
  async refresh(options: RequestOptions = {}): Promise<void> {
    const connection = this.#connection;
    if (connection === undefined || this.#pages.size === 0) return;
    const { targetInfos } = await connection.send('Target.getTargets', undefined, options);
    let changed = false;
    for (const target of targetInfos) {
      if (this.#byTarget.get(target.targetId)?.update(target)) changed = true;
    }
    if (changed) this.#notify();
  }

  get(id: PageId): ChromePage | undefined {
    return this.#pages.get(id);
  }

  /** The session's own pages, most recently used first. */
  ofSession(sessionId: string): ChromePage[] {
    return this.#byRecentUse().filter((page) => page.sessionId === sessionId);
  }

  /**
   * The pages a session may use, most recently used first: its own, and those the user
   * opened in Chrome, which belong to no session.
   */
  reachableBy(sessionId: string): ChromePage[] {
    return this.#byRecentUse().filter(
      (page) => page.sessionId === sessionId || page.sessionId === undefined,
    );
  }

  /** Every page, most recently used first. */
  all(): ChromePage[] {
    return this.#byRecentUse();
  }

  /**
   * The session's page in front, as its view shows it: the one with the focus, or else the
   * most recently used one in view.
   */
  async pageInFront(sessionId: string): Promise<ChromePage | undefined> {
    const pages = this.#byRecentUse().filter((page) => page.sessionId === sessionId);
    // A page that shows a dialog answers nothing else until it is answered.
    const asking = pages.find((page) => page.dialog !== undefined);
    if (asking !== undefined) return asking;
    const views = await Promise.all(pages.map((page) => page.inView()));
    return (
      pages.find((_page, index) => views[index] === 'focused') ??
      pages.find((_page, index) => views[index] === 'visible')
    );
  }

  /**
   * Keeps the pages Chrome reports meanwhile from being given a session by their windows, until
   * the returned function is called: a command that creates a target claims it after Chrome
   * has reported it, and its claim, not the window's place, says whose the page is.
   */
  holdPlacement(): () => void {
    this.#placementHolds += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#placementHolds -= 1;
      if (this.#placementHolds > 0) return;
      for (const page of [...this.#unplaced]) this.#placeInSession(page);
      this.#unplaced.clear();
    };
  }

  /** Records that the user or the agent worked with the page. */
  touch(id: PageId): void {
    if (!this.#pages.has(id) || this.#lastUse.get(id) === this.#useCount) return;
    this.#lastUse.set(id, ++this.#useCount);
    this.#notify();
  }

  /** Listens to pages being added, removed, used, claimed, or changing address, title or dialog. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Listens to pages opening other pages. */
  onPageOpened(listener: (opening: PageOpening) => void): () => void {
    this.#openingListeners.add(listener);
    return () => this.#openingListeners.delete(listener);
  }

  #adopt(
    connection: CdpConnection,
    target: Protocol.Target.TargetInfo,
    cdpSession: string,
    waitingForDebugger: boolean,
  ): void {
    if (this.#byTarget.has(target.targetId)) return;
    const opener = target.openerId === undefined ? undefined : this.#byTarget.get(target.openerId);
    const claim = this.#claims.get(target.targetId);
    this.#claims.delete(target.targetId);
    const origin =
      claim ??
      (opener === undefined
        ? { sessionId: undefined, openedBy: 'user' as const }
        : { sessionId: opener.sessionId, openedBy: 'page' as const });
    const page = new Page(this.#idFor(target.targetId), target, cdpSession, connection, {
      ...origin,
      openerId: opener?.id,
    });
    this.#pages.set(page.id, page);
    this.#byTarget.set(page.targetId, page);
    this.#byCdpSession.set(cdpSession, page);
    this.#lastUse.set(page.id, ++this.#useCount);
    // Chrome reports a page's dialogs once its Page domain is on; a new page then runs. A page
    // that cannot take either is closing, and its ending follows.
    void page
      .send('Page.enable')
      .catch(() => {})
      .then(() => (waitingForDebugger ? page.send('Runtime.runIfWaitingForDebugger') : undefined))
      .catch(() => {});
    if (origin.sessionId === undefined) this.#placeInSession(page);
    for (const adopted of [...(this.#adoptionWaiters.get(page.targetId) ?? [])]) adopted(page);
    if (opener !== undefined && claim === undefined) {
      for (const listener of [...this.#openingListeners]) listener({ page, opener });
    }
    this.#notify();
  }

  /** Gives a page no one claimed to the session whose screen its window is on. */
  #placeInSession(page: Page): void {
    const sessionOf = this.#sessionOfTarget;
    if (sessionOf === undefined || page.sessionId !== undefined || page.ending !== undefined)
      return;
    if (this.#placementHolds > 0) {
      this.#unplaced.add(page);
      return;
    }
    sessionOf(page.targetId).then(
      (sessionId) => {
        if (sessionId === undefined || page.ending !== undefined) return;
        if (page.claim({ sessionId, openedBy: page.openedBy })) this.#notify();
      },
      // A page whose window cannot be found is ending; its ending follows.
      () => {},
    );
  }

  #dialogChanged(cdpSession: string | undefined, dialog: PageDialog | undefined): void {
    const page = cdpSession === undefined ? undefined : this.#byCdpSession.get(cdpSession);
    if (page === undefined) return;
    page.updateDialog(dialog);
    this.#notify();
  }

  #byRecentUse(): Page[] {
    return [...this.#pages.values()].sort(
      (a, b) => (this.#lastUse.get(b.id) ?? 0) - (this.#lastUse.get(a.id) ?? 0),
    );
  }

  /** The target's page id; in the rare case another page holds it, the next free derivation. */
  #idFor(targetId: string): PageId {
    for (let attempt = 0; ; attempt++) {
      const digest = createHash('sha256').update(`${targetId}\0${attempt}`).digest('hex');
      const id = `p${digest.slice(0, 6)}`;
      if (!this.#pages.has(id)) return id;
    }
  }

  #remove(page: Page, ending: PageEnding): void {
    this.#pages.delete(page.id);
    this.#byTarget.delete(page.targetId);
    this.#byCdpSession.delete(page.cdpSession);
    this.#lastUse.delete(page.id);
    page.end(ending);
    this.#notify();
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

/** The dialog a `Page.javascriptDialogOpening` event announces. */
function dialogOf(params: Protocol.Page.JavascriptDialogOpeningEvent): PageDialog {
  const { type, message, defaultPrompt, url } = params;
  return {
    kind:
      type === 'alert' || type === 'confirm' || type === 'prompt' || type === 'beforeunload'
        ? type
        : 'alert',
    message: typeof message === 'string' ? message : '',
    defaultPrompt: typeof defaultPrompt === 'string' ? defaultPrompt : '',
    url: typeof url === 'string' ? url : '',
  };
}
