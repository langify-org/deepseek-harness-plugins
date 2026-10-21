import type { MouseButton } from '../../protocol/viewer.ts';

/** `PointerEvent.button` to CDP's button names. */
export function mouseButton(button: number): MouseButton {
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return 'none';
  }
}

const MULTI_CLICK_MS = 500;
const MULTI_CLICK_DISTANCE = 4;

/**
 * Counts consecutive presses for CDP's `clickCount`: a press close in time and place to
 * the previous one with the same button continues the sequence (double click, triple
 * click), as the operating system would count them.
 */
export class ClickCounter {
  #last: { x: number; y: number; time: number; button: MouseButton; count: number } | undefined;

  press(x: number, y: number, time: number, button: MouseButton): number {
    const last = this.#last;
    const continues =
      last !== undefined &&
      last.button === button &&
      time - last.time <= MULTI_CLICK_MS &&
      Math.hypot(x - last.x, y - last.y) <= MULTI_CLICK_DISTANCE;
    const count = continues ? last.count + 1 : 1;
    this.#last = { x, y, time, button, count };
    return count;
  }

  /** The count a release reports: the one of the press it ends. */
  get current(): number {
    return this.#last?.count ?? 1;
  }
}

/** `WheelEvent.deltaMode` units, converted to the pixels CDP expects. */
export function wheelPixels(
  event: { readonly deltaX: number; readonly deltaY: number; readonly deltaMode: number },
  pageHeight: number,
): { readonly deltaX: number; readonly deltaY: number } {
  const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? pageHeight : 1;
  return { deltaX: event.deltaX * unit, deltaY: event.deltaY * unit };
}

const LINE_PIXELS = 16;
const TAP_SLOP = 8;
const TAP_MS = 500;

export type TouchAction =
  | { readonly type: 'tap'; readonly x: number; readonly y: number }
  | {
      readonly type: 'scroll';
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
    };

/**
 * Turns one finger's touch into what a desktop page understands: a short touch that
 * barely moves is a tap (a click); a moving touch scrolls the page under it.
 * Coordinates are page CSS pixels.
 */
export class TouchGesture {
  #start: { x: number; y: number; time: number } | undefined;
  #last: { x: number; y: number } | undefined;
  #scrolling = false;

  begin(x: number, y: number, time: number): void {
    this.#start = { x, y, time };
    this.#last = { x, y };
    this.#scrolling = false;
  }

  move(x: number, y: number): TouchAction | undefined {
    const start = this.#start;
    const last = this.#last;
    if (start === undefined || last === undefined) return undefined;
    if (!this.#scrolling && Math.hypot(x - start.x, y - start.y) < TAP_SLOP) return undefined;
    this.#scrolling = true;
    this.#last = { x, y };
    // The finger drags the content, so the page scrolls the opposite way.
    return { type: 'scroll', x, y, deltaX: last.x - x, deltaY: last.y - y };
  }

  end(time: number): TouchAction | undefined {
    const start = this.#start;
    this.#start = undefined;
    this.#last = undefined;
    if (start === undefined || this.#scrolling || time - start.time > TAP_MS) return undefined;
    return { type: 'tap', x: start.x, y: start.y };
  }
}
