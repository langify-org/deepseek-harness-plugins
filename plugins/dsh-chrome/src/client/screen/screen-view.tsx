import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  type CompositionEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { KEYSYM, routeKey } from './keysyms.ts';
import { ScreenConnection, type ScreenStatus } from './screen-connection.ts';

/** What the tab around the screen may ask of it. */
export interface ScreenHandle {
  screenshot(): Promise<Blob>;
  /** Focuses the input surface, which raises a touch screen's keyboard. */
  showKeyboard(): void;
}

export interface ScreenViewProps {
  readonly openSocket: () => ConnectionWebSocket;
  /** Whether to be connected; the view connects again after a drop while it is. */
  readonly active: boolean;
  /** The view's size changed, in CSS pixels. */
  readonly onArea: (width: number, height: number) => void;
  /** The user works in the view: a press, a key, text. */
  readonly onInteract: () => void;
  readonly onStatus: (status: ScreenStatus) => void;
  readonly onHandle: (handle: ScreenHandle | undefined) => void;
}

/**
 * How soon after the user's last press or key a new clipboard of the screen is taken for the
 * user's own: Chrome copied for them (a shortcut, a menu, a page's button). A copy without one
 * was the agent's, or a page's on its own, and stays in Chrome.
 */
const COPY_WINDOW_MS = 2000;
/** On macOS, ⌘ plays Ctrl's part, and Option chooses characters. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Chrome's screen, and the surface that takes the user's keys and text for it.
 *
 * The surface is a text field over the bottom of the screen. Keys go from it to the screen as
 * they are pressed. Text the user's input method composes shows in the field while it is
 * composed, as in any text field, and goes to the screen once it is done; so does what a
 * touch screen's keyboard types. A copy the user makes in Chrome reaches the user's own
 * clipboard too; the paste shortcut pastes the user's own clipboard, or Chrome's when the
 * browser kept Chrome's copy from reaching the user's.
 */
export function ScreenView({
  openSocket,
  active,
  onArea,
  onInteract,
  onStatus,
  onHandle,
}: ScreenViewProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const connectionRef = useRef<ScreenConnection>();
  /** When the user last pressed or typed in the view. */
  const inputAtRef = useRef(0);
  /** Whether Chrome's clipboard holds a copy of the user's that their own does not. */
  const screenCopyNewerRef = useRef(false);
  const [composing, setComposing] = useState(false);
  // The latest callbacks, for the listeners that outlive a render.
  const callbacks = useRef({ onArea, onInteract, onStatus, onHandle });
  callbacks.current = { onArea, onInteract, onStatus, onHandle };
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const target = targetRef.current;
    if (target === null) return;
    const connection = new ScreenConnection({
      target,
      openSocket,
      onStatus: (status) => callbacks.current.onStatus(status),
      onClipboard: (text) => {
        if (Date.now() - inputAtRef.current > COPY_WINDOW_MS) return;
        screenCopyNewerRef.current = true;
        void navigator.clipboard?.writeText(text).then(
          () => {
            screenCopyNewerRef.current = false;
          },
          () => {},
        );
      },
    });
    connectionRef.current = connection;
    if (activeRef.current) connection.start();
    callbacks.current.onHandle({
      screenshot: () => connection.screenshot(),
      showKeyboard: () => inputRef.current?.focus({ preventScroll: true }),
    });
    return () => {
      connection.stop();
      connectionRef.current = undefined;
      callbacks.current.onHandle(undefined);
    };
  }, [openSocket]);

  useEffect(() => {
    const connection = connectionRef.current;
    if (active) connection?.start();
    else connection?.stop();
  }, [active]);

  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) callbacks.current.onArea(width, height);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const connection = () => connectionRef.current;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed into Chrome are Chrome's: DSH's own shortcuts do not see them.
    event.stopPropagation();
    // The user's input method is composing; its text comes once it is done.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    inputAtRef.current = Date.now();
    onInteract();
    // macOS reports Caps Lock turning on as a press, and turning off as a release.
    if (MAC && event.key === 'CapsLock') {
      event.preventDefault();
      connection()?.tap(KEYSYM.CapsLock);
      return;
    }
    const routing = routeKey(
      {
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        altGraph: event.getModifierState('AltGraph'),
      },
      { mac: MAC },
    );
    switch (routing.kind) {
      case 'key':
        event.preventDefault();
        connection()?.press(event.code || event.key, routing.keysym);
        return;
      case 'character':
        event.preventDefault();
        connection()?.type(routing.character);
        return;
      case 'paste':
        // The browser pastes the user's own clipboard into the field (onPaste), unless the
        // user's last copy in Chrome could not reach it.
        if (screenCopyNewerRef.current) {
          event.preventDefault();
          connection()?.paste('');
        }
        return;
      case 'none':
        return;
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (MAC && event.key === 'CapsLock') {
      event.preventDefault();
      connection()?.tap(KEYSYM.CapsLock);
      return;
    }
    connection()?.release(event.code || event.key);
    // macOS reports no release of a key let go while ⌘ is held: ⌘'s release releases them all.
    if (MAC && event.key === 'Meta') connection()?.releaseAll();
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    setComposing(false);
    onInteract();
    connection()?.type(event.data);
    event.currentTarget.value = '';
  };

  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const input = event.nativeEvent as InputEvent;
    const field = event.currentTarget;
    if (input.isComposing) return;
    onInteract();
    switch (input.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        connection()?.type(input.data ?? field.value);
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        connection()?.tap(KEYSYM.Return);
        break;
      case 'deleteContentBackward':
        connection()?.tap(KEYSYM.BackSpace);
        break;
    }
    field.value = '';
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    onInteract();
    // Without text (an image, say), Chrome pastes its own clipboard.
    connection()?.paste(event.clipboardData.getData('text/plain'));
    screenCopyNewerRef.current = false;
  };

  return (
    <div
      ref={areaRef}
      style={areaStyle}
      onPointerDownCapture={(event) => {
        inputAtRef.current = Date.now();
        onInteract();
        // A touch would raise the touch screen's keyboard; it has a button of its own.
        if (event.pointerType !== 'touch') inputRef.current?.focus({ preventScroll: true });
      }}
    >
      <div ref={targetRef} style={targetStyle} />
      <textarea
        ref={inputRef}
        aria-label="Type into Chrome"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={composing ? composingStyle : inputStyle}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={onCompositionEnd}
        onInput={onInput}
        onPaste={onPaste}
        onBlur={() => connection()?.releaseAll()}
      />
    </div>
  );
}

const areaStyle: CSSProperties = {
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  background: '#202124',
};
const targetStyle: CSSProperties = { position: 'absolute', inset: 0 };
const inputStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: '2.2em',
  boxSizing: 'border-box',
  padding: '0.4em 0.6em',
  border: 0,
  outline: 'none',
  resize: 'none',
  font: 'inherit',
  opacity: 0,
  // It takes keys, not presses: those go to the screen.
  pointerEvents: 'none',
};
const composingStyle: CSSProperties = {
  ...inputStyle,
  opacity: 1,
  color: 'CanvasText',
  background: 'Canvas',
  borderTop: '1px solid color-mix(in srgb, CanvasText 25%, transparent)',
};
