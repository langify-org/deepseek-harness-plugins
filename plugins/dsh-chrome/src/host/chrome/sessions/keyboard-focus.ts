import { setTimeout as sleep } from 'node:timers/promises';
import type { Log } from '../../platform/log.ts';
import type { XConnection } from '../display/x-connection.ts';

export interface KeyboardFocusDependencies {
  /** The connection to the screen's X server, while one is open. */
  readonly xConnection: () => XConnection | undefined;
  /** The session whose screen holds the point, in device pixels. */
  readonly sessionAt: (x: number, y: number) => string | undefined;
  /**
   * Asks Chrome to bring the session's front window forward, which gives it the focus, and
   * returns without waiting for it.
   * @returns false when the session has no window.
   */
  readonly activate: (sessionId: string) => Promise<boolean>;
  readonly log: Log;
  /** The time now, in milliseconds; tests set it. */
  readonly now?: () => number;
}

/** How often, and how many times, a window Chrome brings forward is checked for the focus. */
const ACTIVATION_CHECK_MS = 10;
const ACTIVATION_CHECKS = 30;
/**
 * How long a session whose window did not take the focus is not asked again: while its window
 * cannot take it, each of its keys would wait, and every session's keys behind them.
 */
const FAILED_ACTIVATION_PAUSE_MS = 5000;
/** How often a failure to give the keyboard is logged, at most. */
const WARNING_INTERVAL_MS = 60_000;

/**
 * Where the user's keys go. The screen has one keyboard focus for every session's windows,
 * and a session's window can take it while the user types in another session's view: a
 * window its agent works in, or one a page opens. So a key the user types in a session's
 * view goes to that session: before it is passed on, the focus goes back to the session's
 * window that had it last, or else to its front window. One key is passed on at a time,
 * so that sessions typed in at once each get their own.
 */
export class KeyboardFocus {
  readonly #deps: KeyboardFocusDependencies;
  /** The window of each session that last had the focus. */
  readonly #lastFocused = new Map<string, number>();
  /** When each session's window last did not take the focus Chrome asked for. */
  readonly #failedActivation = new Map<string, number>();
  #queue: Promise<void> = Promise.resolve();
  #lastWarning = Number.NEGATIVE_INFINITY;

  constructor(deps: KeyboardFocusDependencies) {
    this.#deps = deps;
  }

  /**
   * Gives the focus to the session's windows, then passes a key on with `deliver`, which
   * writes it to the screen: the X server handles it after the change of focus.
   */
  deliver(sessionId: string, deliver: () => void): Promise<void> {
    const run = this.#queue.then(async () => {
      try {
        await this.#focus(sessionId);
      } catch (error) {
        // The key still goes, to the window that has the focus.
        this.#warn(
          `dsh-chrome: could not give the session's window the keyboard: ${String(error)}`,
        );
      }
      deliver();
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  /** Forgets the session's windows: a new screen has others. */
  reset(): void {
    this.#lastFocused.clear();
    this.#failedActivation.clear();
  }

  #now(): number {
    return this.#deps.now?.() ?? Date.now();
  }

  #warn(message: string): void {
    const now = this.#now();
    if (now - this.#lastWarning < WARNING_INTERVAL_MS) return;
    this.#lastWarning = now;
    this.#deps.log.warn(message);
  }

  async #focus(sessionId: string): Promise<void> {
    const x = this.#deps.xConnection();
    if (x === undefined || x.closed) return;
    const focused = await x.inputFocus();
    if (focused !== undefined && (await this.#sessionOf(x, focused)) === sessionId) {
      this.#lastFocused.set(sessionId, focused);
      return;
    }
    const last = this.#lastFocused.get(sessionId);
    if (last !== undefined) {
      try {
        if ((await this.#sessionOf(x, last)) === sessionId) {
          await x.focus(last);
          return;
        }
      } catch {
        // The window is gone, or no longer shown.
      }
      this.#lastFocused.delete(sessionId);
    }
    const failedAt = this.#failedActivation.get(sessionId);
    if (failedAt !== undefined && this.#now() - failedAt < FAILED_ACTIVATION_PAUSE_MS) return;
    if (!(await this.#deps.activate(sessionId))) return;
    for (let check = 0; check < ACTIVATION_CHECKS; check += 1) {
      const now = await x.inputFocus();
      if (now !== undefined && (await this.#sessionOf(x, now)) === sessionId) {
        this.#lastFocused.set(sessionId, now);
        this.#failedActivation.delete(sessionId);
        return;
      }
      await sleep(ACTIVATION_CHECK_MS);
    }
    this.#failedActivation.set(sessionId, this.#now());
    this.#warn(
      "dsh-chrome: the session's window did not take the keyboard; its keys go where the focus is",
    );
  }

  /** The session whose screen holds the middle of the window. */
  async #sessionOf(x: XConnection, window: number): Promise<string | undefined> {
    const bounds = await x.boundsOf(window);
    return this.#deps.sessionAt(
      bounds.x + Math.floor(bounds.width / 2),
      bounds.y + Math.floor(bounds.height / 2),
    );
  }
}
