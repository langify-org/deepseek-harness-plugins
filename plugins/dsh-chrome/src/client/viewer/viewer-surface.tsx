import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { FrameHeader } from '../../protocol/viewer.ts';
import { fitFrame, type Placement, type Size, toPagePoint } from './frame-fit.ts';
import { editInputs, isComposing, isPasteShortcut, keyInput, modifiersOf } from './keyboard.ts';
import { ClickCounter, mouseButton, TouchGesture, wheelPixels } from './pointer.ts';
import type { ViewerSession } from './viewer-session.ts';

/** Size reports wait for the surface to settle, so dragging a divider relays out once. */
const RESIZE_SETTLE_MS = 120;

interface DrawnFrame {
  readonly bitmap: ImageBitmap;
  readonly header: FrameHeader;
}

/**
 * The page's pixels and the user's hands on them. Frames are drawn to a canvas, fitted
 * without distortion. Pointer, wheel and keyboard input over the canvas is sent to the
 * page in its own coordinates. Text arrives through a hidden text area, so that input
 * methods (Japanese conversion, phone keyboards) work as they do anywhere else, and only
 * their finished text is sent.
 *
 * A mouse press focuses the text area. A touch does not, because a phone would raise its
 * keyboard on every tap; the keyboard button raises it instead.
 */
export function ViewerSurface({ session }: { readonly session: ViewerSession }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keyboardRef = useRef<HTMLTextAreaElement>(null);
  const drawn = useRef<DrawnFrame | undefined>(undefined);
  const placement = useRef<{ readonly area: Placement; readonly frame: Size } | undefined>(
    undefined,
  );
  const clicks = useRef(new ClickCounter());
  const touch = useRef(new TouchGesture());
  const [composing, setComposing] = useState(false);
  const [touchScreen] = useState(() => window.matchMedia('(any-pointer: coarse)').matches);

  /** Draws the latest frame to fit the canvas. It reads only refs, so it never changes. */
  /** The page point under a pointer, or `undefined` outside the drawn frame. Reads only refs. */
  const pagePoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const current = placement.current;
    if (canvas == null || current === undefined) return undefined;
    const bounds = canvas.getBoundingClientRect();
    return toPagePoint(
      current.area,
      current.frame,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = drawn.current;
    const context = canvas?.getContext('2d');
    if (canvas == null || frame === undefined || context == null) return;
    const scale = window.devicePixelRatio || 1;
    const surface = { width: canvas.width / scale, height: canvas.height / scale };
    const size = { width: frame.header.width, height: frame.header.height };
    const area = fitFrame(surface, size);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, surface.width, surface.height);
    context.drawImage(frame.bitmap, area.x, area.y, area.width, area.height);
    placement.current = { area, frame: size };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container === null || canvas === null) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      // A hidden tab measures 0×0; keep the page's layout until it is shown again.
      if (width < 1 || height < 1) return;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      draw();
      clearTimeout(settle);
      settle = setTimeout(
        () => session.resize({ width, height, deviceScaleFactor: scale }),
        RESIZE_SETTLE_MS,
      );
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, [session, draw]);

  useEffect(
    () =>
      session.onFrame((header, image) => {
        createImageBitmap(new Blob([image], { type: 'image/jpeg' })).then(
          (bitmap) => {
            drawn.current?.bitmap.close();
            drawn.current = { bitmap, header };
            draw();
            session.frameDrawn(header.seq);
          },
          () => session.frameDrawn(header.seq),
        );
      }),
    [session, draw],
  );

  useEffect(() => () => drawn.current?.bitmap.close(), []);

  // Phone keyboards report most typing only as `beforeinput`, without usable key events.
  useEffect(() => {
    const keyboard = keyboardRef.current;
    if (keyboard === null) return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.isComposing) return;
      const inputs = editInputs(event.inputType, event.data);
      if (inputs === undefined) return;
      event.preventDefault();
      for (const input of inputs) session.input(input);
    };
    keyboard.addEventListener('beforeinput', onBeforeInput);
    return () => keyboard.removeEventListener('beforeinput', onBeforeInput);
  }, [session]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pagePoint(event);
    if (point === undefined) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      touch.current.begin(point.x, point.y, event.timeStamp);
      return;
    }
    keyboardRef.current?.focus({ preventScroll: true });
    const button = mouseButton(event.button);
    session.input({
      kind: 'mouse',
      action: 'down',
      ...point,
      button,
      buttons: event.buttons,
      clickCount: clicks.current.press(point.x, point.y, event.timeStamp, button),
      modifiers: modifiersOf(event),
    });
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pagePoint(event);
    if (point === undefined) return;
    if (event.pointerType === 'touch') {
      const action = touch.current.move(point.x, point.y);
      if (action?.type === 'scroll') session.input({ kind: 'wheel', ...action, modifiers: 0 });
      return;
    }
    session.input({
      kind: 'mouse',
      action: 'move',
      ...point,
      button: 'none',
      buttons: event.buttons,
      clickCount: 0,
      modifiers: modifiersOf(event),
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = pagePoint(event);
    if (event.pointerType === 'touch') {
      const action = touch.current.end(event.timeStamp);
      if (action?.type !== 'tap') return;
      const tap = {
        x: action.x,
        y: action.y,
        button: 'left',
        clickCount: 1,
        modifiers: 0,
      } as const;
      session.input({ kind: 'mouse', action: 'down', ...tap, buttons: 1 });
      session.input({ kind: 'mouse', action: 'up', ...tap, buttons: 0 });
      return;
    }
    if (point === undefined) return;
    session.input({
      kind: 'mouse',
      action: 'up',
      ...point,
      button: mouseButton(event.button),
      buttons: event.buttons,
      clickCount: clicks.current.current,
      modifiers: modifiersOf(event),
    });
  };

  // React listens to wheel events passively, so the sidebar around the page would scroll
  // too; a listener of our own can keep the wheel for the page.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (event: WheelEvent) => {
      const point = pagePoint(event);
      if (point === undefined) return;
      event.preventDefault();
      const height = placement.current?.frame.height ?? 600;
      session.input({
        kind: 'wheel',
        ...point,
        ...wheelPixels(event, height),
        modifiers: modifiersOf(event),
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [session, pagePoint]);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, action: 'down' | 'up') => {
    const key = event.nativeEvent;
    if (isComposing(key) || isPasteShortcut(key)) return;
    event.preventDefault();
    session.input(keyInput(key, action));
  };

  return (
    <div ref={containerRef} style={surfaceStyle}>
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => touch.current.end(Number.POSITIVE_INFINITY)}
        onContextMenu={(event) => event.preventDefault()}
      />
      {touchScreen ? (
        <button
          type="button"
          style={keyboardButtonStyle}
          aria-label="Show the keyboard"
          title="Show the keyboard"
          onClick={() => keyboardRef.current?.focus({ preventScroll: true })}
        >
          ⌨
        </button>
      ) : null}
      <textarea
        ref={keyboardRef}
        aria-label="Type into the page"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        style={composing ? composingStyle : keyboardStyle}
        onKeyDown={(event) => onKey(event, 'down')}
        onKeyUp={(event) => onKey(event, 'up')}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setComposing(false);
          if (event.data) session.input({ kind: 'text', text: event.data });
          event.currentTarget.value = '';
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          if (text) session.input({ kind: 'text', text });
        }}
      />
    </div>
  );
}

const surfaceStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
};
const canvasStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  touchAction: 'none',
  cursor: 'default',
};
/** Off the canvas but focusable: the text area only collects keyboard and IME input. */
const keyboardStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  bottom: 0,
  width: 1,
  height: 1,
  opacity: 0,
  border: 0,
  padding: 0,
  resize: 'none',
  pointerEvents: 'none',
};
const keyboardButtonStyle: CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  width: 40,
  height: 40,
  borderRadius: 20,
  border: '1px solid color-mix(in srgb, CanvasText 25%, transparent)',
  background: 'color-mix(in srgb, Canvas 85%, transparent)',
  color: 'CanvasText',
  font: 'inherit',
  fontSize: 20,
};
/** While an input method composes, its text shows along the bottom edge. */
const composingStyle: CSSProperties = {
  ...keyboardStyle,
  width: '100%',
  height: '2em',
  opacity: 1,
  padding: '0.25em 0.5em',
  background: 'Canvas',
  color: 'CanvasText',
  borderTop: '1px solid color-mix(in srgb, CanvasText 25%, transparent)',
};
