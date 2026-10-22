import { CdpError } from '../chrome/cdp/cdp-connection.ts';
import type { ChromePage } from '../chrome/pages/page.ts';
import { ElementRefError, type PageElement } from './element-refs.ts';
import { type KeyPress, parseKeyCombo, typedText } from './keys.ts';

/**
 * What the agent does to a page, as trusted input events: the same events a person's
 * mouse and keyboard produce, sent through CDP.
 */

/** Scrolls the element into view and returns its centre, in viewport CSS pixels. */
async function elementCentre(
  page: ChromePage,
  { backendNodeId, ref }: PageElement,
): Promise<{ x: number; y: number }> {
  try {
    await page.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
    const { quads } = await page.send('DOM.getContentQuads', { backendNodeId });
    const quad = quads.find((candidate) => quadArea(candidate) > 1);
    if (quad === undefined) throw new ElementRefError(`element ${ref} is not visible`);
    return quadCentre(quad);
  } catch (error) {
    throw elementError(error, `element ${ref} is not on the page anymore`);
  }
}

/**
 * The error to report when Chrome could not act on an element. Chrome refusing the node
 * means the element is gone; anything else (the call was stopped, the browser left) keeps
 * its own meaning.
 */
function elementError(error: unknown, gone: string): unknown {
  if (!(error instanceof CdpError) || error.failure !== 'protocol') return error;
  return new ElementRefError(`${gone} (${error.message}); take a new snapshot`);
}

export async function click(
  page: ChromePage,
  element: PageElement,
  clickCount: 1 | 2,
): Promise<void> {
  const { x, y } = await elementCentre(page, element);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    buttons: 0,
  });
  for (let count = 1; count <= clickCount; count += 1) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: count,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: count,
    });
  }
}

export interface TypeOptions {
  /** The field to type into; without it, text goes to the focused element. */
  readonly element?: PageElement | undefined;
  /** Replace the field's current text instead of adding to it. */
  readonly replace: boolean;
  /** Press Enter afterwards. */
  readonly submit: boolean;
}

export async function type(page: ChromePage, text: string, options: TypeOptions): Promise<void> {
  const { element } = options;
  if (element !== undefined) {
    await page
      .send('DOM.focus', { backendNodeId: element.backendNodeId })
      .catch((error: unknown) => {
        throw elementError(error, `cannot focus element ${element.ref}`);
      });
  }
  if (options.replace) {
    // The editing command selects all text in the focused field, whatever the platform.
    await page.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      commands: ['selectAll'],
    });
    await page.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
    });
    if (text === '') await press(page, parseKeyCombo('Backspace'));
  }
  if (text !== '') await page.send('Input.insertText', { text });
  if (options.submit) await press(page, parseKeyCombo('Enter'));
}

export async function press(page: ChromePage, keyPress: KeyPress): Promise<void> {
  const { key, modifiers } = keyPress;
  const text = typedText(keyPress);
  const base = {
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    nativeVirtualKeyCode: key.keyCode,
    modifiers,
  };
  await page.send('Input.dispatchKeyEvent', {
    ...base,
    // `keyDown` also types the key's text; `rawKeyDown` presses a key that types none.
    type: text === '' ? 'rawKeyDown' : 'keyDown',
    ...(text === '' ? {} : { text, unmodifiedText: text }),
  });
  await page.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

export interface ScrollOptions {
  /** Scroll until this element is in view. */
  readonly element?: PageElement | undefined;
  /** Pixels to scroll down (negative: up); defaults to most of a screen. */
  readonly deltaY?: number | undefined;
}

export async function scroll(page: ChromePage, options: ScrollOptions): Promise<void> {
  if (options.element !== undefined) {
    await elementCentre(page, options.element);
    return;
  }
  const { cssLayoutViewport } = await page.send('Page.getLayoutMetrics');
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: cssLayoutViewport.clientWidth / 2,
    y: cssLayoutViewport.clientHeight / 2,
    deltaX: 0,
    deltaY: options.deltaY ?? Math.round(cssLayoutViewport.clientHeight * 0.8),
  });
}

export type NavigationTarget =
  | { readonly url: string }
  | { readonly history: 'back' | 'forward' | 'reload' };

/** How long a navigation may take before the agent gets control back anyway. */
const LOAD_WAIT_MS = 15_000;

/**
 * Navigates and waits for the new document to load, or for {@link LOAD_WAIT_MS}: a slow
 * page is still usable, and the agent can look at it.
 * @param signal - ends the wait for the load early, with its reason.
 * @returns whether the page finished loading in time.
 */
export async function navigate(
  page: ChromePage,
  target: NavigationTarget,
  signal?: AbortSignal,
): Promise<boolean> {
  if (page.ending !== undefined) throw new Error('the page is closed');
  signal?.throwIfAborted();
  await page.send('Page.enable');
  const { frameTree } = await page.send('Page.getFrameTree');
  const load = waitForLoad(page, frameTree.frame.id, signal);
  try {
    if ('url' in target) {
      const { errorText } = await page.send('Page.navigate', { url: target.url });
      if (errorText !== undefined) throw new Error(`could not open ${target.url}: ${errorText}`);
    } else if (target.history === 'reload') {
      await page.send('Page.reload');
    } else {
      const { currentIndex, entries } = await page.send('Page.getNavigationHistory');
      const entry = entries[currentIndex + (target.history === 'back' ? -1 : 1)];
      if (entry === undefined) throw new Error(`there is no page to go ${target.history} to`);
      await page.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    }
  } catch (error) {
    load.cancel();
    throw error;
  }
  return load.loaded;
}

/**
 * Waits until the main frame shows the navigation's result, the page ends, or
 * {@link LOAD_WAIT_MS} pass. A new document reports its load event; a document restored
 * from the back-forward cache and a same-document navigation report none, so they count
 * as soon as Chrome reports them.
 */
function waitForLoad(
  page: ChromePage,
  mainFrameId: string,
  signal: AbortSignal | undefined,
): { readonly loaded: Promise<boolean>; cancel(): void } {
  let finish: (loaded: boolean) => void = () => {};
  const loaded = new Promise<boolean>((resolve, reject) => {
    const subscriptions: (() => void)[] = [];
    let settled = false;
    const settle = (settleWith: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const unsubscribe of subscriptions) unsubscribe();
      settleWith();
    };
    finish = (result) => settle(() => resolve(result));
    const timer = setTimeout(() => finish(false), LOAD_WAIT_MS);
    if (signal !== undefined) {
      const abort = () => settle(() => reject(signal.reason));
      signal.addEventListener('abort', abort, { once: true });
      subscriptions.push(() => signal.removeEventListener('abort', abort));
    }
    subscriptions.push(
      page.on('Page.loadEventFired', () => finish(true)),
      page.on('Page.frameNavigated', ({ frame, type }) => {
        if (frame.parentId === undefined && type === 'BackForwardCacheRestore') finish(true);
      }),
      page.on('Page.navigatedWithinDocument', ({ frameId }) => {
        if (frameId === mainFrameId) finish(true);
      }),
      page.onEnded(() => finish(false)),
    );
  });
  // A navigation that fails first never awaits the wait; its abort must not go unhandled,
  // since DSH ends on an unhandled rejection.
  loaded.catch(() => {});
  return { loaded, cancel: () => finish(false) };
}

function quadArea(quad: readonly number[]): number {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] = quad;
  return Math.abs(
    (x1 * y2 - x2 * y1 + (x2 * y3 - x3 * y2) + (x3 * y4 - x4 * y3) + (x4 * y1 - x1 * y4)) / 2,
  );
}

function quadCentre(quad: readonly number[]): { x: number; y: number } {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] = quad;
  return { x: (x1 + x2 + x3 + x4) / 4, y: (y1 + y2 + y3 + y4) / 4 };
}
