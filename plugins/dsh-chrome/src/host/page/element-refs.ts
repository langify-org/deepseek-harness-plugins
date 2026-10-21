import type { ChromePage, PageId } from '../runtime/pages.ts';
import { readSnapshot, type Snapshot } from './snapshot.ts';

/** An element of a page, as the agent's actions address it. */
export interface PageElement {
  /** Chrome's backend DOM node id. */
  readonly backendNodeId: number;
  /** The snapshot ref that named it, for messages to the agent. */
  readonly ref: string;
}

export class ElementRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElementRefError';
  }
}

/** How often a snapshot is read again when the page navigates while it is read. */
const SNAPSHOT_ATTEMPTS = 3;

/**
 * The element refs the agent took from each page's latest snapshot.
 *
 * A ref (`e42`) is Chrome's backend DOM node id, which is unique only within one renderer
 * process: after a navigation to another site, the same number can name an unrelated
 * element. Refs therefore belong to the document their snapshot was read from, and a ref
 * resolves only while the page still shows that document. A same-document navigation
 * (a single-page app changing its route) keeps them.
 */
export class ElementRefs {
  /** The main-frame document, by its loader id, that each page's refs were read from. */
  readonly #documents = new Map<PageId, string>();

  /** Reads the page's snapshot and makes its refs the page's current refs. */
  async snapshot(page: ChromePage, maxChars: number): Promise<Snapshot> {
    for (let attempt = 1; ; attempt += 1) {
      const before = await documentOf(page);
      const snapshot = await readSnapshot(page, maxChars);
      if ((await documentOf(page)) === before) {
        if (!this.#documents.has(page.id)) page.onEnded(() => this.#documents.delete(page.id));
        this.#documents.set(page.id, before);
        return snapshot;
      }
      if (attempt === SNAPSHOT_ATTEMPTS) {
        throw new Error('the page kept navigating while it was read; try again once it settles');
      }
    }
  }

  /**
   * The element a ref names on the page.
   * @throws ElementRefError when the ref is malformed, or the page no longer shows the
   * document of the snapshot the ref came from.
   */
  async resolve(page: ChromePage, ref: string): Promise<PageElement> {
    const match = /^e(\d+)$/.exec(ref.trim());
    if (match?.[1] === undefined) {
      throw new ElementRefError(
        `"${ref}" is not an element ref; refs look like e42 and come from chrome_snapshot`,
      );
    }
    const document = this.#documents.get(page.id);
    if (document === undefined) {
      throw new ElementRefError(`take a snapshot of page ${page.id} before acting on ${ref}`);
    }
    if ((await documentOf(page)) !== document) {
      throw new ElementRefError(
        `page ${page.id} has shown another document since the snapshot ${ref} came from; ` +
          'take a new snapshot',
      );
    }
    return { backendNodeId: Number(match[1]), ref: match[0] };
  }
}

/** The page's main-frame document: the loader a navigation to a new document replaces. */
async function documentOf(page: ChromePage): Promise<string> {
  const { frameTree } = await page.send('Page.getFrameTree');
  return frameTree.frame.loaderId;
}
