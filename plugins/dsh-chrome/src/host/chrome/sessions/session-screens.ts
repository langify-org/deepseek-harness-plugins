import type { Log } from '../../platform/log.ts';
import {
  MAX_MONITORS,
  type Monitor,
  type ScreenLayout,
  type ScreenSize,
  sameLayout,
} from '../display/screen-control.ts';

/** The widest screen Xvnc makes, in device pixels. */
export const MAX_SCREEN_WIDTH = 16_384;
/** The smallest and largest side of one session's screen, in device pixels. */
const MIN_SESSION_SIDE = 200;
const MAX_SESSION_SIDE = 8192;
/** The parking monitor's id: apart from the slots', which count from 1. */
export const PARKING_MONITOR_ID = MAX_MONITORS;

/** A slot of the screen: a monitor's place, a session's while it has one. */
interface Slot {
  sessionId: string | undefined;
  size: ScreenSize;
}

/**
 * Which part of the screen each DSH session's Chrome windows are on: its session screen, a
 * monitor of the screen, in device pixels. The monitors stand side by side, each the size its
 * session asks for, so that sessions shown at once each have their own. A session that no
 * view shows needs none: the windows of all such sessions share one monitor, the parking
 * monitor, at the right, while any has a window.
 *
 * A session keeps its slot, and the monitor its id, while it has one; a slot a session gives up
 * keeps its size, empty, until another session takes it, and the last slots go when they are
 * empty: the screen always has one. Its windows are not this class's: the window manager
 * places a window on the monitor it overlaps most as the layout changes, and the Chrome
 * service puts the windows back on their sessions' monitors.
 *
 * The layout is applied to the screen while one runs ({@link attach}), one change at a time:
 * while one is applied, later ones wait, and only the last of them is applied.
 */
export class SessionScreens {
  readonly #defaultSize: () => ScreenSize;
  readonly #log: Log;
  readonly #slots: Slot[];
  readonly #listeners = new Set<() => void>();
  /** Whether the parking monitor is wanted. */
  #parking = false;
  #apply: ((layout: ScreenLayout) => Promise<void>) | undefined;
  /** The layout as last applied to the screen that runs. */
  #applied: ScreenLayout | undefined;
  #applying: Promise<void> = Promise.resolve();
  #scheduled = false;

  /**
   * @param defaultSize - the size of a session's screen until it asks for one, and the parking
   * monitor's, in device pixels, as it is now.
   */
  constructor(defaultSize: () => ScreenSize, log: Log) {
    this.#defaultSize = () => clampSize(defaultSize());
    this.#log = log;
    this.#slots = [{ sessionId: undefined, size: this.#defaultSize() }];
  }

  /** The screen's layout, as asked for. */
  get layout(): ScreenLayout {
    return this.#layoutOf(this.#slots, this.#parking);
  }

  /** The parking monitor, as applied to the screen that runs, while it is wanted. */
  get parkingMonitor(): Monitor | undefined {
    return this.#applied?.monitors.find((monitor) => monitor.id === PARKING_MONITOR_ID);
  }

  /**
   * Applies the layout again: the default size it takes for the parking monitor depends on
   * Chrome's scale, which changes when Chrome starts.
   */
  relayout(): void {
    this.#schedule();
  }

  /** Wants the parking monitor, or no longer. */
  setParking(wanted: boolean): void {
    if (wanted === this.#parking) return;
    this.#parking = wanted;
    this.#trim();
    // The screen keeps a monitor: a slot, when the parking monitor goes.
    if (this.#slots.length === 0 && !wanted) {
      this.#slots.push({ sessionId: undefined, size: this.#defaultSize() });
    }
    this.#schedule();
  }

  /** The sessions that have a screen. */
  get sessions(): string[] {
    return this.#slots.flatMap((slot) => (slot.sessionId === undefined ? [] : [slot.sessionId]));
  }

  /** The session's screen, as applied to the screen that runs; undefined until it is. */
  monitorOf(sessionId: string): Monitor | undefined {
    const index = this.#slots.findIndex((slot) => slot.sessionId === sessionId);
    if (index === -1) return undefined;
    return this.#applied?.monitors.find((monitor) => monitor.id === idOf(index));
  }

  /** The session whose screen, as applied, holds the point. */
  sessionAt(x: number, y: number): string | undefined {
    const monitor = this.#applied?.monitors.find(
      (candidate) =>
        x >= candidate.x &&
        x < candidate.x + candidate.width &&
        y >= candidate.y &&
        y < candidate.y + candidate.height,
    );
    if (monitor === undefined || monitor.id === PARKING_MONITOR_ID) return undefined;
    return this.#slots[monitor.id - 1]?.sessionId;
  }

  /**
   * Gives the session a screen of the size, in a free slot, or resizes the one it has.
   * @throws when the screen has no room for it.
   */
  set(sessionId: string, size: ScreenSize): void {
    const wanted = clampSize(size);
    let slot = this.#slots.find((candidate) => candidate.sessionId === sessionId);
    const taken = slot === undefined;
    if (slot === undefined) {
      slot = this.#slots.find((candidate) => candidate.sessionId === undefined);
      if (slot === undefined) {
        if (this.#slots.length >= MAX_MONITORS) throw noRoom();
        slot = { sessionId: undefined, size: wanted };
        this.#slots.push(slot);
      }
      slot.sessionId = sessionId;
    }
    const before = slot.size;
    slot.size = wanted;
    if (this.layout.width > MAX_SCREEN_WIDTH) {
      slot.size = before;
      if (taken) slot.sessionId = undefined;
      this.#trim();
      throw noRoom();
    }
    this.#schedule();
  }

  /**
   * Gives the session a screen of its own if it has none, of the default size.
   * @throws when the screen has no room for it.
   */
  ensure(sessionId: string): void {
    if (!this.sessions.includes(sessionId)) this.set(sessionId, this.#defaultSize());
  }

  /** Frees the session's screen; the slot keeps its size until another session takes it. */
  remove(sessionId: string): void {
    const slot = this.#slots.find((candidate) => candidate.sessionId === sessionId);
    if (slot === undefined) return;
    slot.sessionId = undefined;
    this.#trim();
    this.#schedule();
  }

  /** Applies the layout with `apply` from now on: a screen started, with a layout of its own. */
  attach(apply: (layout: ScreenLayout) => Promise<void>): void {
    this.#apply = apply;
    this.#applied = undefined;
    this.#schedule();
  }

  /** The screen stopped. */
  detach(): void {
    this.#apply = undefined;
    this.#applied = undefined;
  }

  /** Resolves once the layout asked for so far is applied, or failed to be, or no screen runs. */
  async settled(): Promise<void> {
    for (;;) {
      const applying = this.#applying;
      await applying;
      if (applying === this.#applying && !this.#scheduled) return;
    }
  }

  /** Listens to the screens changing, once each layout is applied. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Removes the empty slots at the right; the screen keeps one monitor, a slot or parking. */
  #trim(): void {
    const keep = this.#parking ? 0 : 1;
    while (this.#slots.length > keep && this.#slots.at(-1)?.sessionId === undefined) {
      this.#slots.pop();
    }
  }

  #schedule(): void {
    if (this.#scheduled || this.#apply === undefined) return;
    this.#scheduled = true;
    this.#applying = this.#applying.then(async () => {
      this.#scheduled = false;
      const apply = this.#apply;
      const layout = this.layout;
      if (apply === undefined) return;
      if (this.#applied !== undefined && sameLayout(layout, this.#applied)) return;
      try {
        await apply(layout);
      } catch (error) {
        this.#log.warn(`dsh-chrome: could not lay the screen out: ${String(error)}`);
        return;
      }
      if (this.#apply !== apply) return;
      this.#applied = layout;
      for (const listener of [...this.#listeners]) {
        try {
          listener();
        } catch (error) {
          // The next layouts are applied all the same.
          this.#log.warn(`dsh-chrome: a listener to the screen's layout failed: ${String(error)}`);
        }
      }
    });
  }

  /** The slots side by side, from the left, and the parking monitor after them when wanted. */
  #layoutOf(slots: readonly Slot[], parking: boolean): ScreenLayout {
    let x = 0;
    const monitors = slots.map((slot, index) => {
      const monitor = { id: idOf(index), x, y: 0, ...slot.size };
      x += slot.size.width;
      return monitor;
    });
    if (parking) {
      const size = this.#defaultSize();
      monitors.push({ id: PARKING_MONITOR_ID, x, y: 0, ...size });
      x += size.width;
    }
    return {
      width: x,
      height: Math.max(...monitors.map((monitor) => monitor.height)),
      monitors,
    };
  }
}

/** A slot's monitor id: its index, counted from 1, so that it stays with the slot. */
function idOf(index: number): number {
  return index + 1;
}

function clampSize(size: ScreenSize): ScreenSize {
  const clamp = (side: number) =>
    Math.min(MAX_SESSION_SIDE, Math.max(MIN_SESSION_SIDE, Math.round(side)));
  return { width: clamp(size.width), height: clamp(size.height) };
}

function noRoom(): Error {
  return new Error(
    "the screen has no room for another session's Chrome: close the Chrome tab of a session you no longer look at",
  );
}
