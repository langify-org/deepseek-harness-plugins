import type { Viewport } from '../../protocol/viewer.ts';
import type { ChromePage, PageId } from '../chrome/pages/page.ts';
import type { Log } from '../platform/log.ts';

/** One encoded image of the page viewport. */
export interface ScreenFrame {
  readonly image: Buffer;
  /** The CSS size of the page area the image shows. */
  readonly width: number;
  readonly height: number;
}

/** Someone showing the page: a viewer connection. */
export interface ScreenViewer {
  /** The viewer's current drawing surface. */
  readonly viewport: Viewport;
  /** Whether the viewer is on screen. Frames are produced only while some viewer is. */
  readonly visible: boolean;
  showFrame(frame: ScreenFrame): void;
}

export interface ScreenOptions {
  /** JPEG quality of frames, 1–100. */
  readonly jpegQuality: number;
  /** How often a hidden page is captured while someone views it. */
  readonly hiddenFrameIntervalMs: number;
  /** The highest device scale factor the page emulates, to bound frame sizes. */
  readonly maxDeviceScaleFactor: number;
}

/** The size the page is laid out at, in CSS pixels, and its pixel density. */
interface Layout {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
}

/** After a layout change, a capture follows this soon unless a screencast frame comes first. */
const LAYOUT_CAPTURE_MS = 300;
/** While a visible page sends no screencast frames, it is captured this often. */
const STALLED_CAPTURE_MS = 1000;
/** After input, a capture follows this soon unless a screencast frame comes first. */
const INPUT_CAPTURE_MS = 80;
/** The largest render surface, in device pixels each way: larger ones exhaust the renderer. */
const MAX_SURFACE_SIZE = 8192;
/** Frames may differ from the layout by rounding; a larger difference means a lost layout. */
const SIZE_TOLERANCE = 1.5;

/** Whether a frame shows the page at a layout's size, give or take Chrome's rounding. */
export function frameShowsLayout(
  frame: { readonly width: number; readonly height: number },
  layout: { readonly width: number; readonly height: number },
): boolean {
  return (
    Math.abs(frame.width - layout.width) <= SIZE_TOLERANCE &&
    Math.abs(frame.height - layout.height) <= SIZE_TOLERANCE
  );
}
/**
 * How long frames of a lost layout are held back while the layout is applied again, and
 * how often it is applied again while it stays lost.
 */
const RELAYOUT_HOLD_MS = 1000;

/**
 * Produces frames of one page for the viewers showing it, and lays the page out for the
 * viewport owner: the viewer that most recently attached or sent input.
 *
 * Layout. The page emulates the owner's viewport with `Emulation.setDeviceMetricsOverride`,
 * and Chrome sizes the page's render surface to match, so frames show exactly that
 * viewport. When the browser window lays itself out again (its debugging infobar
 * appearing, the user resizing it), Chrome gives the surface the window's size back;
 * a frame of another size reveals that, and the layout is applied again.
 *
 * Frames. While the page is visible, Chrome screencasts it and sends a frame whenever it
 * repaints. Whenever no frame has come for a while, the page is captured instead with
 * `Page.captureScreenshot`, which Chrome renders even for a page it does not show, and an
 * unchanged capture is dropped. That covers every way the screencast falls silent: a still
 * page, a hidden page (a background tab, a minimized window), and a window the system has
 * stopped drawing (a locked screen). A page Chrome reports hidden is captured more often,
 * and input is followed by a capture soon, so that the user sees what their input did.
 */
export class PageScreen {
  readonly page: ChromePage;
  readonly #options: ScreenOptions;
  readonly #log: Log;
  readonly #viewers = new Set<ScreenViewer>();
  readonly #unsubscribe: (() => void)[] = [];
  #owner: ScreenViewer | undefined;
  #layout: Layout | undefined;
  /** When frames of another size than the layout started arriving. */
  #layoutLostAt: number | undefined;
  /** When the lost layout was last applied again. */
  #relayoutAt = 0;
  /** Whether frames are produced: while some viewer is on screen. */
  #streaming = false;
  /** Whether Chrome may be screencasting: from starting the screencast until stopping it. */
  #screencastRunning = false;
  #hidden = false;
  #lastFrame: ScreenFrame | undefined;
  #lastCapture: string | undefined;
  #captureTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the armed capture is the quick one that follows input. */
  #captureFollowsInput = false;
  #commands: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(page: ChromePage, options: ScreenOptions, log: Log) {
    this.page = page;
    this.#options = options;
    this.#log = log;
    this.#unsubscribe.push(
      page.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        void page.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        const frame = {
          image: Buffer.from(data, 'base64'),
          width: metadata.deviceWidth,
          height: metadata.deviceHeight,
        };
        if (!this.#acceptsFrameSize(frame)) return;
        // The screen moved on from the last capture; the next one is news even if it repeats it.
        this.#lastCapture = undefined;
        this.#publish(frame);
      }),
      page.on('Page.screencastVisibilityChanged', ({ visible }) => {
        this.#hidden = !visible;
        this.#scheduleCapture();
      }),
    );
  }

  get viewerCount(): number {
    return this.#viewers.size;
  }

  /** Shows the page to a viewer, which becomes the viewport owner. */
  addViewer(viewer: ScreenViewer): void {
    this.#viewers.add(viewer);
    if (this.#lastFrame !== undefined) viewer.showFrame(this.#lastFrame);
    // Only the active tab of a window is rendered.
    void this.page.activate().catch((error: unknown) => this.#warn('activate the page', error));
    this.claimOwnership(viewer);
    this.#syncFrameSource();
  }

  removeViewer(viewer: ScreenViewer): void {
    this.#viewers.delete(viewer);
    // The page keeps the last owner's layout until another viewer claims it.
    if (this.#owner === viewer) this.#owner = undefined;
    this.#syncFrameSource();
  }

  /** Makes the viewer the viewport owner, and lays the page out for its viewport. */
  claimOwnership(viewer: ScreenViewer): void {
    if (!this.#viewers.has(viewer) || this.#owner === viewer) return;
    this.#owner = viewer;
    this.viewportChanged(viewer);
  }

  /** The viewer's surface changed size; if it owns the viewport, the page follows. */
  viewportChanged(viewer: ScreenViewer): void {
    if (this.#owner !== viewer) return;
    const { width, height } = viewer.viewport;
    const deviceScaleFactor = Math.min(
      viewer.viewport.deviceScaleFactor,
      this.#options.maxDeviceScaleFactor,
    );
    // At least a pixel: a zero size would turn the override off.
    const size = (cssPixels: number) =>
      Math.max(
        1,
        Math.min(Math.round(cssPixels), Math.floor(MAX_SURFACE_SIZE / deviceScaleFactor)),
      );
    const layout: Layout = { width: size(width), height: size(height), deviceScaleFactor };
    const current = this.#layout;
    if (
      current !== undefined &&
      current.width === layout.width &&
      current.height === layout.height &&
      current.deviceScaleFactor === layout.deviceScaleFactor
    ) {
      return;
    }
    this.#layout = layout;
    this.#layoutLostAt = undefined;
    this.#enqueue(() => this.#applyLayout(layout));
  }

  /** A viewer went on or off screen. */
  visibilityChanged(): void {
    this.#syncFrameSource();
  }

  /** A viewer's input reached the page; its effect is shown soon even without frames. */
  inputDispatched(): void {
    // Further input keeps the armed capture: moving the mouse must not postpone it.
    if (this.#captureTimer !== undefined && this.#captureFollowsInput) return;
    this.#scheduleCapture(INPUT_CAPTURE_MS);
    this.#captureFollowsInput = this.#captureTimer !== undefined;
  }

  /** Stops producing frames and gives the page its window's own layout back. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#viewers.clear();
    this.#clearTimers();
    if (this.page.ending !== undefined) return;
    // Commands still queued are dropped, a stop among them included.
    if (this.#screencastRunning) void this.page.send('Page.stopScreencast').catch(() => {});
    if (this.#layout !== undefined) {
      void this.page.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
  }

  /** Starts or stops producing frames as viewers come on and off screen. */
  #syncFrameSource(): void {
    const wanted = !this.#disposed && [...this.#viewers].some((viewer) => viewer.visible);
    if (wanted && !this.#streaming) {
      this.#streaming = true;
      this.#enqueue(() => this.#startScreencast());
    } else if (!wanted && this.#streaming) {
      this.#streaming = false;
      this.#enqueue(async () => {
        await this.page.send('Page.stopScreencast');
        this.#screencastRunning = false;
      });
    }
    this.#scheduleCapture();
  }

  async #startScreencast(): Promise<void> {
    // From here on a stop may be due, even if the screen is disposed while this runs.
    this.#screencastRunning = true;
    await this.page.send('Page.enable');
    // A screencast left running by an earlier host would refuse a new one.
    await this.page.send('Page.stopScreencast');
    if (this.#disposed) return;
    // No size limit: the render surface already has the layout's size and density.
    await this.page.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.#options.jpegQuality,
    });
    this.#scheduleCapture(LAYOUT_CAPTURE_MS);
  }

  async #applyLayout(layout: Layout): Promise<void> {
    await this.page.send('Emulation.setDeviceMetricsOverride', {
      width: layout.width,
      height: layout.height,
      deviceScaleFactor: layout.deviceScaleFactor,
      mobile: false,
    });
    this.#scheduleCapture(LAYOUT_CAPTURE_MS);
  }

  /**
   * Whether a screencast frame shows the page at its layout. A frame of another size means
   * Chrome gave the surface back to the window: the layout is applied again, and frames are
   * held back meanwhile. If the layout stays lost, frames are shown as they are, since they
   * are better than nothing, and the layout is applied again once in a while.
   */
  #acceptsFrameSize(frame: ScreenFrame): boolean {
    const layout = this.#layout;
    if (layout === undefined || frameShowsLayout(frame, layout)) {
      this.#layoutLostAt = undefined;
      return true;
    }
    const now = performance.now();
    if (this.#layoutLostAt === undefined) {
      this.#layoutLostAt = now;
      this.#relayoutAt = now;
      this.#enqueue(() => this.#applyLayout(layout));
      return false;
    }
    if (now - this.#relayoutAt >= RELAYOUT_HOLD_MS) {
      this.#relayoutAt = now;
      this.#enqueue(() => this.#applyLayout(layout));
    }
    return now - this.#layoutLostAt >= RELAYOUT_HOLD_MS;
  }

  /**
   * Arms the capture that runs if no frame arrives first: after `delay`, or after the
   * usual wait for the page's state. Every published frame re-arms it.
   */
  #scheduleCapture(delay?: number): void {
    this.#clearTimers();
    if (!this.#streaming || this.#disposed) return;
    const wait = delay ?? (this.#hidden ? this.#options.hiddenFrameIntervalMs : STALLED_CAPTURE_MS);
    this.#captureTimer = setTimeout(() => {
      this.#captureTimer = undefined;
      void this.#capture().finally(() => {
        if (this.#captureTimer === undefined) this.#scheduleCapture();
      });
    }, wait);
  }

  async #capture(): Promise<void> {
    if (this.#disposed || this.page.ending !== undefined) return;
    try {
      const [{ data }, size] = await Promise.all([
        this.page.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: this.#options.jpegQuality,
          optimizeForSpeed: true,
        }),
        this.#viewportSize(),
      ]);
      if (data === this.#lastCapture) return;
      this.#lastCapture = data;
      this.#publish({ image: Buffer.from(data, 'base64'), ...size });
    } catch (error) {
      this.#warn('capture the page', error);
    }
  }

  /**
   * The CSS size of what a capture shows: the whole viewport, scrollbars included. Under the
   * layout's emulation that is the layout. Without one, the visual viewport stands in for
   * the window's viewport, leaving the scrollbars out.
   */
  async #viewportSize(): Promise<{ width: number; height: number }> {
    const layout = this.#layout;
    if (layout !== undefined) return { width: layout.width, height: layout.height };
    const { cssVisualViewport } = await this.page.send('Page.getLayoutMetrics');
    return { width: cssVisualViewport.clientWidth, height: cssVisualViewport.clientHeight };
  }

  #publish(frame: ScreenFrame): void {
    if (this.#disposed) return;
    this.#lastFrame = frame;
    for (const viewer of this.#viewers) viewer.showFrame(frame);
    this.#scheduleCapture();
  }

  /** Page commands run one at a time and in order: a later layout must win. */
  #enqueue(command: () => Promise<void>): void {
    this.#commands = this.#commands
      .then(() => (this.#disposed || this.page.ending !== undefined ? undefined : command()))
      .catch((error: unknown) => this.#warn('update the page view', error));
  }

  #clearTimers(): void {
    clearTimeout(this.#captureTimer);
    this.#captureTimer = undefined;
    this.#captureFollowsInput = false;
  }

  #warn(action: string, error: unknown): void {
    if (this.page.ending === undefined) {
      this.#log.warn(`dsh-chrome: could not ${action}: ${String(error)}`);
    }
  }
}

/** The screens of pages that currently have viewers. */
export class ScreenRegistry {
  readonly #options: ScreenOptions;
  readonly #log: Log;
  readonly #screens = new Map<
    PageId,
    { readonly screen: PageScreen; readonly forget: () => void }
  >();

  constructor(options: ScreenOptions, log: Log) {
    this.#options = options;
    this.#log = log;
  }

  /** The page's screen, created on first use. */
  screenOf(page: ChromePage): PageScreen {
    const existing = this.#screens.get(page.id);
    if (existing !== undefined) return existing.screen;
    const screen = new PageScreen(page, this.#options, this.#log);
    const forget = page.onEnded(() => this.#drop(page.id));
    this.#screens.set(page.id, { screen, forget });
    return screen;
  }

  /** Disposes the screen once nobody views it. */
  release(screen: PageScreen): void {
    if (screen.viewerCount === 0) this.#drop(screen.page.id);
  }

  disposeAll(): void {
    for (const id of [...this.#screens.keys()]) this.#drop(id);
  }

  #drop(id: PageId): void {
    const entry = this.#screens.get(id);
    if (entry === undefined) return;
    this.#screens.delete(id);
    entry.forget();
    entry.screen.dispose();
  }
}
