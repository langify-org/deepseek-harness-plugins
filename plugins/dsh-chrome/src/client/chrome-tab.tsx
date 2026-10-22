import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AddToMessageResult } from './message-attachments.ts';
import { type ScreenHandle, ScreenView } from './screen/screen-view.tsx';
import { ViewerSession, type ViewerSnapshot } from './viewer/viewer-session.ts';

/** What the plugin injects into each Chrome tab body. */
export interface ChromeTabInjected {
  /** Opens the viewer socket: state and requests. */
  readonly openViewerSocket: () => ConnectionWebSocket;
  /** Opens the screen socket: Chrome's screen, as VNC. */
  readonly openScreenSocket: () => ConnectionWebSocket;
  /** Attaches files to the session's next message. */
  readonly addToMessage: (
    sessionId: SessionIdOf,
    files: readonly File[],
    inputActions: InputActions | undefined,
  ) => AddToMessageResult;
}

const ADD_TO_MESSAGE_NOTICES: Readonly<Record<AddToMessageResult, string>> = {
  added: 'Added to your message.',
  busy: 'Your message is being sent; try again in a moment.',
  unavailable: 'There is no message box here to add the page to.',
};

export interface ChromeTabProps extends ChromeTabInjected {
  readonly sessionId: SessionIdOf;
  readonly useTabInfo: UseSidebarRightTabInfo;
  /** The session's message composer, when the conversation UI is present. */
  readonly inputActions?: InputActions | undefined;
}

/**
 * The body of a Chrome tab in the right sidebar: Chrome's screen, the agent's requests for
 * help, and buttons to add what Chrome shows to the user's message. Every Chrome tab shows the
 * same Chrome; the screen is laid out for the tab the user last worked in.
 */
export function ChromeTab({
  sessionId,
  openViewerSocket,
  openScreenSocket,
  addToMessage,
  inputActions,
  useTabInfo,
}: ChromeTabProps) {
  const { tab } = useTabInfo();
  const [session, setSession] = useState<ViewerSession>();

  useEffect(() => {
    const created = new ViewerSession({ sessionId, openSocket: openViewerSocket });
    setSession(created);
    return () => created.dispose();
  }, [sessionId, openViewerSocket]);

  const requestedUrl = urlParam(tab.navigation.params);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each navigation of the tab opens its address, even the same one again.
  useEffect(() => {
    if (session !== undefined && requestedUrl !== undefined) session.open(requestedUrl);
  }, [session, requestedUrl, tab.navigation.revision]);

  const documentVisible = useDocumentVisible();
  if (session === undefined) return null;
  const attach = (files: readonly File[]) =>
    session.notify(ADD_TO_MESSAGE_NOTICES[addToMessage(sessionId, files, inputActions)]);
  return (
    <ChromeScreen
      session={session}
      openScreenSocket={openScreenSocket}
      visible={tab.visible && documentVisible}
      addToMessage={attach}
    />
  );
}

function ChromeScreen({
  session,
  openScreenSocket,
  visible,
  addToMessage,
}: {
  readonly session: ViewerSession;
  readonly openScreenSocket: () => ConnectionWebSocket;
  /** Whether the tab is on screen; a hidden tab lets go of the screen's stream. */
  readonly visible: boolean;
  readonly addToMessage: (files: readonly File[]) => void;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const screenRef = useRef<ScreenHandle>();
  const [screenConnected, setScreenConnected] = useState(false);
  const chrome = snapshot.chrome;
  // The screen connects while the tab is seen; connecting starts Chrome if it is not running.
  const active = visible && snapshot.connection === 'connected' && chrome?.kind !== 'failed';

  // The screen is laid out for the tab the user looks at: one that comes into view takes it.
  useEffect(() => {
    if (visible && snapshot.connection === 'connected') session.claimScreen();
  }, [visible, snapshot.connection, session]);

  const addScreenshot = () => {
    screenRef.current?.screenshot().then(
      (image) => addToMessage([new File([image], 'chrome.png', { type: 'image/png' })]),
      (error: unknown) => session.notify(`Could not capture the screen: ${String(error)}`),
    );
  };
  const addText = () => {
    session.readText().then(
      (page) =>
        addToMessage([new File([page.text], `${fileStem(page)}.md`, { type: 'text/markdown' })]),
      (error: unknown) => session.notify(`Could not read the page: ${messageOf(error)}`),
    );
  };

  return (
    <div style={columnStyle}>
      <div style={toolbarStyle}>
        <span style={statusStyle}>{statusText(snapshot, screenConnected)}</span>
        {action('Add a screenshot to your message', addScreenshot, '📷', !screenConnected)}
        {action(
          'Add the text of the page you are looking at to your message',
          addText,
          '📄',
          chrome?.kind !== 'running',
        )}
        {action(
          'Show the keyboard',
          () => screenRef.current?.showKeyboard(),
          '⌨',
          !screenConnected,
        )}
      </div>
      {snapshot.help === undefined ? null : (
        <div role="alert" style={bannerStyle}>
          <span style={{ flex: 1 }}>
            <strong>The agent asks you:</strong> {snapshot.help.message}
            {snapshot.help.pageTitle === '' ? null : <em> ({snapshot.help.pageTitle})</em>}
          </span>
          <button type="button" style={buttonStyle} onClick={() => session.answerHelp('done')}>
            Done
          </button>
          <button type="button" style={buttonStyle} onClick={() => session.answerHelp('declined')}>
            I can’t
          </button>
        </div>
      )}
      <StateNotice snapshot={snapshot} session={session} />
      <div style={screenColumnStyle}>
        <ScreenView
          openSocket={openScreenSocket}
          active={active}
          onArea={(width, height) => session.setArea(width, height)}
          onInteract={() => session.claimScreen()}
          onStatus={(status) => setScreenConnected(status === 'connected')}
          onHandle={(handle) => {
            screenRef.current = handle;
          }}
        />
        {snapshot.notice === undefined ? null : (
          // Each notice is a toast of its own, with its own time.
          <Toast
            key={snapshot.notice}
            notice={snapshot.notice}
            onDismiss={() => session.notify(undefined)}
          />
        )}
      </div>
    </div>
  );
}

/** How long a passing notice stays. */
const TOAST_MS = 6000;

/**
 * A passing notice, over the bottom of the screen: in the layout, it would resize the screen,
 * and Chrome would lay its page out anew, as it comes and as it goes.
 */
function Toast({ notice, onDismiss }: { readonly notice: string; readonly onDismiss: () => void }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <p role="status" style={toastStyle}>
      {notice}{' '}
      <button type="button" style={linkButtonStyle} onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  );
}

/** What stands between the user and Chrome: a lost connection, or Chrome not running. */
function StateNotice({
  snapshot,
  session,
}: {
  readonly snapshot: ViewerSnapshot;
  readonly session: ViewerSession;
}) {
  if (snapshot.connection === 'disconnected') {
    return (
      <p style={noticeStyle}>
        The connection to DSH was lost.{' '}
        <button type="button" style={linkButtonStyle} onClick={() => session.reconnect()}>
          Reconnect
        </button>
      </p>
    );
  }
  const chrome = snapshot.chrome;
  if (chrome?.kind === 'failed') {
    return (
      <p role="alert" style={noticeStyle}>
        Chrome did not start: {chrome.message}{' '}
        <button type="button" style={linkButtonStyle} onClick={() => session.startChrome()}>
          Try again
        </button>
      </p>
    );
  }
  if (chrome?.kind === 'stopped') {
    return (
      <p style={noticeStyle}>
        Chrome is closed.{' '}
        <button type="button" style={linkButtonStyle} onClick={() => session.startChrome()}>
          Open Chrome
        </button>
      </p>
    );
  }
  return null;
}

function statusText(snapshot: ViewerSnapshot, screenConnected: boolean): string {
  if (snapshot.connection !== 'connected') return 'Connecting to DSH…';
  switch (snapshot.chrome?.kind) {
    case 'starting':
      return 'Starting Chrome…';
    case 'running':
      if (!screenConnected) return 'Connecting to the screen…';
      // Another window showed Chrome last: it is fitted into this one until the user works here.
      return snapshot.screenOwner ? 'Chrome' : 'Chrome, sized for another window';
    default:
      return 'Chrome';
  }
}

function action(label: string, onClick: () => void, content: ReactNode, disabled: boolean) {
  return (
    <button
      type="button"
      style={buttonStyle}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {content}
    </button>
  );
}

/** Whether the DSH page itself is on screen: not in a background browser tab or app. */
function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    () => document.visibilityState === 'visible',
  );
}

/** Navigation parameters are JSON-shaped and unchecked; read the URL defensively. */
function urlParam(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null || !('url' in params)) return undefined;
  return typeof params.url === 'string' && params.url !== '' ? params.url : undefined;
}

/** A file name for a page: its title, or its host. */
function fileStem(page: { readonly title: string; readonly url: string }): string {
  const base = page.title || hostOf(page.url) || 'page';
  return (
    base
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
};
const toolbarStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  alignItems: 'center',
  padding: '4px 6px',
  borderBottom: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
};
const statusStyle: CSSProperties = { flex: 1, minWidth: 0, opacity: 0.7, fontSize: '0.9em' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: 6,
  padding: '2px 8px',
  minHeight: 28,
};
const bannerStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  margin: 0,
  padding: '6px 10px',
  background: 'color-mix(in srgb, Highlight 18%, transparent)',
  borderBottom: '1px solid color-mix(in srgb, Highlight 40%, transparent)',
};
const noticeStyle: CSSProperties = {
  margin: 0,
  padding: '6px 10px',
  fontSize: '0.9em',
  opacity: 0.85,
};
const screenColumnStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
};
const toastStyle: CSSProperties = {
  position: 'absolute',
  left: 8,
  right: 8,
  bottom: 8,
  margin: 0,
  padding: '6px 10px',
  fontSize: '0.9em',
  borderRadius: 6,
  color: 'CanvasText',
  background: 'Canvas',
  boxShadow: '0 2px 8px rgb(0 0 0 / 30%)',
};
const linkButtonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: 0,
  textDecoration: 'underline',
  cursor: 'pointer',
};
