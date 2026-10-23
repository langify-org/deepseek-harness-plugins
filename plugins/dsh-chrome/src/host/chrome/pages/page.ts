import type {
  CdpArgs,
  CdpCommand,
  CdpEventName,
  CdpEventParams,
  CdpResult,
} from '../cdp/cdp-methods.ts';

/**
 * A page's id: short, because the agent reads and writes it, and unique among the pages of
 * this Chrome. It is derived from the page's CDP target, so it holds while Chrome runs.
 */
export type PageId = string;

/**
 * Who opened a page: the agent with its tools; the user, in Chrome or from the sidebar; or
 * another page (a popup, a link's new tab).
 */
export type PageOpener = 'agent' | 'user' | 'page';

/** Why a page is no longer there: its tab closed, or Chrome stopped. */
export type PageEnding = 'closed' | 'chrome-stopped';

/** A JavaScript dialog the page opened (`alert`, `confirm`, …), blocking it until answered. */
export interface PageDialog {
  readonly kind: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  readonly message: string;
  /** The text a `prompt` offers; empty for the other kinds. */
  readonly defaultPrompt: string;
  /** The address of the frame that opened it. */
  readonly url: string;
}

/** How one command to a page is sent. */
export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * A page of the Chrome dsh-chrome runs: a tab or a popup window.
 *
 * It belongs to the DSH session whose agent opened it, or whose sidebar did, and a page it
 * opened belongs there too; one the user opened in Chrome belongs to the session whose
 * screen its window is on. A page that is on no session's screen belongs to no session.
 */
export interface ChromePage {
  readonly id: PageId;
  /** The page's CDP target. */
  readonly targetId: string;
  /** The DSH session the page belongs to; `undefined` for one on no session's screen. */
  readonly sessionId: string | undefined;
  readonly openedBy: PageOpener;
  /** The page that opened this one, when another page did. */
  readonly openerId: PageId | undefined;
  readonly url: string;
  readonly title: string;
  /** The dialog the page shows, until it is answered. */
  readonly dialog: PageDialog | undefined;
  /** Set once the page is no longer there. */
  readonly ending: PageEnding | undefined;

  /** Sends one CDP command to the page. */
  send<M extends CdpCommand>(method: M, ...args: CdpArgs<M, RequestOptions>): Promise<CdpResult<M>>;
  /** Listens to one CDP event of the page; returns the unsubscribe function. */
  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void;
  /** Listens to changes of the address, the title, the owning session and the dialog. */
  onChanged(listener: (page: ChromePage) => void): () => void;
  /** Runs once the page ends; immediately if it already has. */
  onEnded(listener: (ending: PageEnding) => void): () => void;
  /** Makes the page the active tab of its window, where its session's view shows it. */
  show(): Promise<void>;
  /**
   * Asks Chrome to make the page the active tab of its window and to bring the window forward,
   * which gives it the focus, and returns without waiting for it.
   */
  activate(): Promise<void>;
  /**
   * Makes the page the active tab of Chrome's focused window, and returns once the window has
   * the focus: Chrome then opens a new tab in that window.
   */
  bringToFront(): Promise<void>;
  /** Closes the tab or window. */
  close(): Promise<void>;
}
