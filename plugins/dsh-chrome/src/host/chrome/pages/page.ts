import type { PageEndReason, TabId } from '../../../protocol/connector.ts';
import type { PageDialogState, PageOpener } from '../../../protocol/viewer.ts';
import type {
  CdpArgs,
  CdpCommand,
  CdpEventName,
  CdpEventParams,
  CdpResult,
} from '../connector/cdp.ts';
import type { ConnectedBrowser, RequestOptions } from '../connector/connected-browser.ts';

/**
 * A page's id: short, because the agent reads and writes it, and unique among the pages of
 * this host. It is derived from the browser and the tab, so a page keeps its id when DSH
 * restarts and adopts it again, and earlier tool results still name it.
 */
export type PageId = string;

/** Why a page is no longer controlled: the connector's reasons, or its browser left. */
export type PageEnding = PageEndReason | 'disconnected';

/** How a page came to be, as far as the host knows; what it does not know is left out. */
export interface PageOrigin {
  readonly openedBy?: PageOpener;
  /** The page that opened it, when another page did. */
  readonly openerId?: PageId;
}

/** A JavaScript dialog the page opened (`alert`, `confirm`, …), blocking it until answered. */
export type PageDialog = PageDialogState;

/** A Chrome tab the plugin opened, owned by one DSH session. */
export interface ChromePage {
  readonly id: PageId;
  readonly sessionId: string;
  readonly browser: ConnectedBrowser;
  readonly tabId: TabId;
  /** `undefined` for a page adopted from a connector that outlived the host. */
  readonly openedBy: PageOpener | undefined;
  /** The page that opened this one, when another page did. */
  readonly openerId: PageId | undefined;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** The dialog the page shows, until it is answered. */
  readonly dialog: PageDialog | undefined;
  /** Set once the page can no longer be controlled. */
  readonly ending: PageEnding | undefined;

  /** Sends one CDP command to the page. */
  send<M extends CdpCommand>(method: M, ...args: CdpArgs<M, RequestOptions>): Promise<CdpResult<M>>;
  /** Listens to one CDP event of the page; returns the unsubscribe function. */
  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void;
  /** Listens to changes of the address, the title, the loading state and the dialog. */
  onChanged(listener: (page: ChromePage) => void): () => void;
  /** Runs once the page ends; immediately if it already has. */
  onEnded(listener: (ending: PageEnding) => void): () => void;
  /** Makes the page its window's active tab, so Chrome renders it. */
  activate(): Promise<void>;
  /**
   * Makes Chrome treat the page as the one in front, as it treats the tab the user looks at:
   * only then does Chrome show the dialogs the page opens. Done only where nobody sees the
   * windows; on a screen someone sees, it would take the user's focus, and does nothing.
   */
  bringToFront(): Promise<void>;
  /** Closes the tab. */
  close(): Promise<void>;
}
