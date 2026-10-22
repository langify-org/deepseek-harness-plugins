import type { ScreenSize } from '../chrome/chrome-service.ts';
import type { Log } from '../platform/log.ts';

export type { ScreenSize };

/** A viewer's screen area, in CSS pixels. */
export interface ViewerArea {
  readonly width: number;
  readonly height: number;
}

/** A viewer, as the screen's layout sees it. */
export interface LayoutViewer {
  /** The viewer's screen area, once it said. */
  readonly area: ViewerArea | undefined;
  /** Tells the viewer whether the screen now follows its size. */
  ownerChanged(owner: boolean): void;
}

/** Chrome keeps its windows at least this many CSS pixels wide, as measured on Linux. */
const CHROME_MIN_WINDOW_WIDTH = 500;

/**
 * Which viewer the screen is laid out for: every viewer shows the one screen, at the size of
 * one of them, its owner. A viewer becomes the owner when the user works in it, or when it
 * is the only one; when the owner leaves, the viewer that was the owner most recently before
 * it takes over. The screen gets the owner's area in device pixels: a CSS pixel of the viewer
 * takes as many of the screen's pixels as a CSS pixel of Chrome does, so Chrome looks as large
 * in the viewer as a page there would, and as sharp as the screen's density allows.
 *
 * Chrome's window is never narrower than {@link CHROME_MIN_WINDOW_WIDTH}: a narrower viewer
 * gets a screen that wide, its height in proportion, which the viewer shows scaled down to fit.
 */
export class ScreenLayout {
  readonly #resize: (size: ScreenSize) => Promise<void>;
  readonly #deviceScaleFactor: number;
  readonly #log: Log;
  /** The viewers, the one that was the owner most recently last. */
  readonly #viewers: LayoutViewer[] = [];
  #owner: LayoutViewer | undefined;
  /** The size last asked of the screen. */
  #applied: ScreenSize | undefined;

  constructor(resize: (size: ScreenSize) => Promise<void>, deviceScaleFactor: number, log: Log) {
    this.#resize = resize;
    this.#deviceScaleFactor = deviceScaleFactor;
    this.#log = log;
  }

  get owner(): LayoutViewer | undefined {
    return this.#owner;
  }

  add(viewer: LayoutViewer): void {
    if (this.#viewers.includes(viewer)) return;
    this.#viewers.unshift(viewer);
    if (this.#owner === undefined) this.claim(viewer);
    else viewer.ownerChanged(false);
  }

  remove(viewer: LayoutViewer): void {
    const index = this.#viewers.indexOf(viewer);
    if (index === -1) return;
    this.#viewers.splice(index, 1);
    if (this.#owner !== viewer) return;
    this.#owner = undefined;
    const next = this.#viewers.at(-1);
    if (next !== undefined) this.claim(next);
  }

  /** Lays the screen out for the viewer. */
  claim(viewer: LayoutViewer): void {
    if (!this.#viewers.includes(viewer)) return;
    this.#viewers.splice(this.#viewers.indexOf(viewer), 1);
    this.#viewers.push(viewer);
    const previous = this.#owner;
    this.#owner = viewer;
    if (previous !== viewer) {
      previous?.ownerChanged(false);
      viewer.ownerChanged(true);
    }
    this.#apply();
  }

  /** The viewer's area changed: the screen follows if the viewer owns it. */
  areaChanged(viewer: LayoutViewer): void {
    if (this.#owner === viewer) this.#apply();
  }

  #apply(): void {
    const area = this.#owner?.area;
    if (area === undefined) return;
    const scale = this.#deviceScaleFactor * Math.max(1, CHROME_MIN_WINDOW_WIDTH / area.width);
    const size = {
      width: Math.round(area.width * scale),
      height: Math.round(area.height * scale),
    };
    if (size.width === this.#applied?.width && size.height === this.#applied.height) return;
    this.#applied = size;
    this.#resize(size).catch((error: unknown) => {
      // The next change tries again.
      this.#applied = undefined;
      this.#log.warn(`dsh-chrome: could not resize the screen: ${String(error)}`);
    });
  }
}
