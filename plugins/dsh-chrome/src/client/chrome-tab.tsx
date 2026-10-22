import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots';
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { normalizeAddress } from '../protocol/address.ts';
import type { PageDialogState } from '../protocol/viewer.ts';
import type { AddToMessageResult } from './message-attachments.ts';
import { ViewerSession, type ViewerSnapshot } from './viewer/viewer-session.ts';
import { ViewerSurface } from './viewer/viewer-surface.tsx';

/** What the plugin injects into each Chrome tab body. */
export interface ChromeTabInjected {
  readonly openViewerSocket: () => ConnectionWebSocket;
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
 * The body of a Chrome tab in the right sidebar: an address bar and the shared page.
 * A tab remembers the page it showed, so a reload or a restart of the web client shows
 * the same page again while it is still open in Chrome.
 */
export function ChromeTab({
  sessionId,
  openViewerSocket,
  addToMessage,
  inputActions,
  useTabInfo,
}: ChromeTabProps) {
  const { tab } = useTabInfo();
  const [session, setSession] = useState<ViewerSession>();

  useEffect(() => {
    const memoryKey = `dsh-chrome.page.${sessionId}.${tab.id}`;
    const created = new ViewerSession({
      sessionId,
      openSocket: openViewerSocket,
      rememberedPageId: localStorage.getItem(memoryKey) ?? undefined,
      rememberPage: (pageId) => {
        if (pageId === undefined) localStorage.removeItem(memoryKey);
        else localStorage.setItem(memoryKey, pageId);
      },
    });
    setSession(created);
    return () => created.dispose();
  }, [sessionId, tab.id, openViewerSocket]);

  const documentVisible = useDocumentVisible();
  useEffect(
    () => session?.setVisible(tab.visible && documentVisible),
    [session, tab.visible, documentVisible],
  );

  const requestedUrl = urlParam(tab.navigation.params);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each navigation of the tab opens its address, even the same one again.
  useEffect(() => {
    if (session !== undefined && requestedUrl !== undefined) session.open(requestedUrl);
  }, [session, requestedUrl, tab.navigation.revision]);

  if (session === undefined) return null;
  const attach = (files: readonly File[]) =>
    session.notify(ADD_TO_MESSAGE_NOTICES[addToMessage(sessionId, files, inputActions)]);
  return <ChromePage session={session} addToMessage={attach} />;
}

function ChromePage({
  session,
  addToMessage,
}: {
  readonly session: ViewerSession;
  readonly addToMessage: (files: readonly File[]) => void;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const addScreenshot = () => {
    const image = session.lastImage;
    if (image === undefined) return;
    addToMessage([new File([image], `${fileStem(snapshot)}.jpg`, { type: 'image/jpeg' })]);
  };
  const addText = () => {
    session.readText().then(
      (page) =>
        addToMessage([
          new File([page.text], `${fileStem(snapshot)}.md`, { type: 'text/markdown' }),
        ]),
      (error: unknown) => session.notify(`Could not read the page: ${String(error)}`),
    );
  };

  return (
    <div style={columnStyle}>
      <Toolbar
        session={session}
        snapshot={snapshot}
        onAddScreenshot={addScreenshot}
        onAddText={addText}
      />
      {snapshot.dedicatedChrome?.display === 'desktop' ? (
        <p role="status" style={helpStyle}>
          <span style={{ flex: 1 }}>
            Chrome is on the screen of the computer DSH runs on, to set it up: sign in to sites or
            to Chrome, add extensions such as 1Password.
          </span>
          <button
            type="button"
            style={buttonStyle}
            onClick={() => session.setDedicatedDisplay('virtual')}
          >
            Done
          </button>
        </p>
      ) : null}
      {snapshot.page?.dialog == null ? null : (
        <PageDialogBar session={session} dialog={snapshot.page.dialog} />
      )}
      {snapshot.help === undefined ? null : (
        <div role="alert" style={helpStyle}>
          <span style={{ flex: 1 }}>
            <strong>The agent asks you:</strong> {snapshot.help.message}
          </span>
          <button type="button" style={buttonStyle} onClick={() => session.answerHelp('done')}>
            Done
          </button>
          <button type="button" style={buttonStyle} onClick={() => session.answerHelp('declined')}>
            I can’t
          </button>
        </div>
      )}
      {snapshot.notice === undefined ? null : (
        <p style={noticeStyle}>
          {snapshot.notice}{' '}
          <button type="button" style={linkButtonStyle} onClick={() => session.notify(undefined)}>
            Dismiss
          </button>
        </p>
      )}
      {snapshot.status === 'disconnected' ? (
        <p style={noticeStyle}>
          The connection to DSH was lost.{' '}
          <button type="button" style={linkButtonStyle} onClick={() => session.reconnect()}>
            Reconnect
          </button>
        </p>
      ) : null}
      {snapshot.page === undefined ? (
        <p style={hintStyle}>Enter an address to open a page in Chrome.</p>
      ) : (
        <ViewerSurface session={session} />
      )}
    </div>
  );
}

/**
 * The dialog the shown page opened. In Chrome it would stand in front of the page, which
 * takes no input until it is answered; here it stands above it.
 */
function PageDialogBar({
  session,
  dialog,
}: {
  readonly session: ViewerSession;
  readonly dialog: PageDialogState;
}) {
  const [promptText, setPromptText] = useState(dialog.defaultPrompt);
  useEffect(() => setPromptText(dialog.defaultPrompt), [dialog]);
  const answer = (accept: boolean) =>
    session.answerDialog(accept, dialog.kind === 'prompt' ? promptText : null);
  const leaving = dialog.kind === 'beforeunload';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    answer(true);
  };
  return (
    <form role="alertdialog" aria-label="The page asks" style={helpStyle} onSubmit={submit}>
      <span style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        <strong>{leaving ? 'Leave this page?' : 'The page asks:'}</strong>{' '}
        {leaving ? 'Changes you made may not be saved.' : dialog.message}
      </span>
      {dialog.kind === 'prompt' ? (
        <input
          style={addressStyle}
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          aria-label="Your answer"
        />
      ) : null}
      <button type="submit" style={buttonStyle}>
        {leaving ? 'Leave' : 'OK'}
      </button>
      {dialog.kind === 'alert' ? null : (
        <button type="button" style={buttonStyle} onClick={() => answer(false)}>
          {leaving ? 'Stay' : 'Cancel'}
        </button>
      )}
    </form>
  );
}

function Toolbar({
  session,
  snapshot,
  onAddScreenshot,
  onAddText,
}: {
  readonly session: ViewerSession;
  readonly snapshot: ViewerSnapshot;
  readonly onAddScreenshot: () => void;
  readonly onAddText: () => void;
}) {
  const shownUrl = snapshot.page?.url ?? '';
  const [address, setAddress] = useState(shownUrl);
  useEffect(() => setAddress(shownUrl), [shownUrl]);
  const hasPage = snapshot.page !== undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const url = normalizeAddress(address);
    if (url === undefined) {
      session.notify(`"${address}" is not a web address.`);
      return;
    }
    if (hasPage) session.navigate(url);
    else session.open(url);
  };

  const action = (label: string, onClick: () => void, content: ReactNode) => (
    <button
      type="button"
      style={buttonStyle}
      disabled={!hasPage}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {content}
    </button>
  );

  return (
    <form style={toolbarStyle} onSubmit={submit}>
      {action('Back', () => session.goBack(), '←')}
      {action('Forward', () => session.goForward(), '→')}
      {action('Reload', () => session.reload(), snapshot.page?.loading ? '×' : '↻')}
      <input
        style={addressStyle}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="Address"
        aria-label="Address"
        spellCheck={false}
        autoCapitalize="off"
      />
      {snapshot.pages.length > 1 ? (
        <select
          style={buttonStyle}
          value={snapshot.page?.id ?? ''}
          onChange={(event) => session.show(event.target.value)}
          aria-label="Pages of this session"
        >
          {snapshot.pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title || page.url}
            </option>
          ))}
        </select>
      ) : null}
      {action('Add a screenshot to your message', onAddScreenshot, '📷')}
      {action('Add the page text to your message', onAddText, '📄')}
      {action('Close page', () => session.closePage(), '✕')}
      {snapshot.dedicatedChrome === undefined || snapshot.dedicatedChrome.state === 'off' ? null : (
        <button
          type="button"
          style={buttonStyle}
          disabled={snapshot.dedicatedChrome.display === 'desktop'}
          onClick={() => session.setDedicatedDisplay('desktop')}
          aria-label={SET_UP_LABEL}
          title={SET_UP_LABEL}
        >
          ⚙
        </button>
      )}
    </form>
  );
}

const SET_UP_LABEL =
  'Set up Chrome: show its window on the computer DSH runs on (Chrome starts again, and its pages close)';

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
  return typeof params.url === 'string' ? normalizeAddress(params.url) : undefined;
}

/** A file name for what the page is: its title, or its host. */
function fileStem(snapshot: ViewerSnapshot): string {
  const page = snapshot.page;
  const base = page?.title || (page === undefined ? '' : hostOf(page.url)) || 'page';
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
const buttonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'transparent',
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: 6,
  padding: '2px 8px',
  minHeight: 28,
};
const addressStyle: CSSProperties = { ...buttonStyle, flex: 1, minWidth: 0 };
const helpStyle: CSSProperties = {
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
const hintStyle: CSSProperties = { ...noticeStyle, padding: 16, opacity: 0.7 };
const linkButtonStyle: CSSProperties = {
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: 0,
  textDecoration: 'underline',
  cursor: 'pointer',
};
