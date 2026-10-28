import type { ScreenSize } from '../chrome/chrome-service.ts';
import type { Log } from '../platform/log.ts';

export type { ScreenSize };

/** A viewer's screen area, in CSS pixels. */
export interface ViewerArea {
  readonly width: number;
  readonly height: number;
}

/** A viewer, as the ownership of its session's screen sees it. */
export interface ScreenViewer {
  /** The viewer's screen area, once it said. */
  readonly area: ViewerArea | undefined;
  /** Tells the viewer whether the screen now follows its size. */
  ownerChanged(owner: boolean): void;
}

/** Chrome keeps its windows at least this many CSS pixels wide, as measured on Linux. */
const CHROME_MIN_WINDOW_WIDTH = 500;

/**
 * Which viewer a session's screen is laid out for: every viewer of the session shows its
 * screen, at the size of one of them, its owner. A viewer becomes the owner when the user works in it, or when it
 * is the only one; when the owner leaves, the viewer that was the owner most recently before
 * it takes over. The screen gets the owner's area in device pixels: a CSS pixel of the viewer
 * takes as many of the screen's pixels as a CSS pixel of Chrome does, so Chrome looks as large
 * in the viewer as a page there would, and as sharp as the screen's density allows.
 *
 * Chrome's window is never narrower than {@link CHROME_MIN_WINDOW_WIDTH}: a narrower viewer
 * gets a screen that wide, its height in proportion, which the viewer shows scaled down to fit.
 */
export class ScreenOwnership {
  readonly #resize: (size: ScreenSize) => Promise<void>;
  readonly #deviceScaleFactor: () => number;
  readonly #log: Log;
  /** The viewers, the one that was the owner most recently last. */
  readonly #viewers: ScreenViewer[] = [];
  #owner: ScreenViewer | undefined;
  /** The size last asked of the screen. */
  #applied: ScreenSize | undefined;

  /**
   * @param resize - sizes the session's screen, in device pixels.
   * @param deviceScaleFactor - how many device pixels a CSS pixel takes in Chrome now.
   */
  constructor(
    resize: (size: ScreenSize) => Promise<void>,
    deviceScaleFactor: () => number,
    log: Log,
  ) {
    this.#resize = resize;
    this.#deviceScaleFactor = deviceScaleFactor;
    this.#log = log;
  }

  get owner(): ScreenViewer | undefined {
    return this.#owner;
  }

  /** Whether no viewer shows the screen. */
  get empty(): boolean {
    return this.#viewers.length === 0;
  }

  add(viewer: ScreenViewer): void {
    if (this.#viewers.includes(viewer)) return;
    this.#viewers.unshift(viewer);
    if (this.#owner === undefined) this.claim(viewer);
    else viewer.ownerChanged(false);
  }

  remove(viewer: ScreenViewer): void {
    const index = this.#viewers.indexOf(viewer);
    if (index === -1) return;
    this.#viewers.splice(index, 1);
    if (this.#owner !== viewer) return;
    this.#owner = undefined;
    const next = this.#viewers.at(-1);
    if (next !== undefined) this.claim(next);
  }

  /** Lays the screen out for the viewer. */
  claim(viewer: ScreenViewer): void {
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
  areaChanged(viewer: ScreenViewer): void {
    if (this.#owner === viewer) this.#apply();
  }

  /** Sizes the screen for its owner again: Chrome started, maybe at another scale factor. */
  refresh(): void {
    this.#apply();
  }

  #apply(): void {
    const area = this.#owner?.area;
    if (area === undefined) return;
    const scale = this.#deviceScaleFactor() * Math.max(1, CHROME_MIN_WINDOW_WIDTH / area.width);
    const size = {
      width: Math.round(area.width * scale),
      height: Math.round(area.height * scale),
    };
    if (size.width === this.#applied?.width && size.height === this.#applied.height) return;
    this.#applied = size;
    this.#resize(size).catch((error: unknown) => {
      // The next change tries again.
      this.#applied = undefined;
      this.#log.warn(`dsh-chrome: could not size the session's screen: ${String(error)}`);
    });
  }
}
