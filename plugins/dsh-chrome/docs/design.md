# dsh-chrome design

dsh-chrome lets the user and the agent work in the same real Chrome. Chrome runs on the DSH
host machine, on a profile of dsh-chrome's own, so it keeps that profile's logins and
extensions. It draws on a screen of its own: an X server that keeps the screen in memory and
serves it over VNC. DSH's right sidebar shows that screen and sends the user's input back;
the agent reads and operates Chrome's pages through tools, over Chrome's DevTools protocol
(CDP).

The sidebar is therefore not a browser. It is a *viewer* of a remote screen: pixels come
in, input goes out. This is what lets Chrome keep real logins (a cross-site iframe never
sees them, and an embedded Electron webview has neither the profile nor native messaging
for 1Password), what shows Chrome's own UI (tabs, menus, extension popups, permission
prompts, file pickers), and what makes Chrome reachable from any device that opens the DSH
web UI.

Before 0.3, the sidebar showed one page: CDP screencast frames as JPEG, and the user's input
replayed as CDP input events, through an extension in the profile. Frames came at the page's
pace and blurred text, the layout flickered as the page was resized for each frame size,
clicks were lost or doubled on the way, and Chrome's own UI stayed out of sight. A screen
served over VNC sends only what changed, keeps text sharp, and takes input as an X server
does from a keyboard and a mouse.

## Concepts

| Concept | Meaning | In code |
|---|---|---|
| **Chrome** | The one Chrome dsh-chrome runs for a DSH home, controlled over the pipe it is started with. It starts when a Chrome tab opens, the user asks, or a tool needs it, and runs until the user closes its last window or the plugin stops. | `ChromeService`, `launchChrome` |
| **Profile** | dsh-chrome's Chrome user data directory, private to the user. Its extensions reach the native apps of the user's own Chrome through linked manifests. | `src/host/chrome/profile/` |
| **Screen** | Where Chrome draws: Xvnc, with Openbox keeping Chrome's window filling it. It serves VNC on a Unix socket, takes the size its viewers set, and outlives Chrome's restarts. | `Display`, `startDisplay` |
| **Viewer** | One Chrome tab of DSH's sidebar, connected over two WebSockets: the screen's (VNC) and the viewer's (state and requests). Several viewers, of one browser or of several (Desktop and a phone), show the same screen. | `ViewerConnection`, `ViewerSession`, `ScreenConnection` |
| **Screen owner** | The viewer whose size the screen has: the one the user last looked at or worked in. | `ScreenLayout` |
| **Page** | A tab or window of Chrome, followed over CDP. It belongs to the DSH session whose agent opened it, or that of the page that opened it; a page the user opened belongs to none until an agent uses it. | `ChromePage`, `PageRegistry` |
| **Page in front** | The page the user looks at: one that shows a dialog, else the focused one, else one in view. Chrome shows that page's dialogs only. | `PageRegistry.pageInFront`, `ChromePage.bringToFront` |
| **Dialog** | A JavaScript dialog a page opened (`alert`, `confirm`, `prompt`, whether to leave). It blocks the page until someone answers it. | `PageDialog`, `src/host/page-operations/dialogs.ts` |
| **Help request** | The agent asking the user to act on a page (sign in, enter a code), and waiting for the answer. | `HelpRequests` |
| **Reading** | What the agent is told about the pages it may use at the start of a turn. | `src/host/context/` |

## Code layout

`src/` has a directory for each place its code runs, which share `protocol/` and nothing
else: `client/` runs in DSH's web client, `host/` in DSH's Host. Each has its own
TypeScript project, so code cannot use an API its runtime lacks.

Each is split by what its parts are, in one direction of use:

| Part | What it is | Uses |
|---|---|---|
| `host/platform/` | The machine: default locations, child processes, the log. | nothing |
| `host/chrome/cdp/` | Chrome's DevTools protocol: the commands and events dsh-chrome uses, the pipe, the connection. | `platform` |
| `host/chrome/display/` | The screen: Xvnc and its cookie, the window manager, the screen's size, its private directory, the record of its processes. | `platform` |
| `host/chrome/process/` | Starting Chrome on the screen, with the pipe. | `platform`, `cdp` |
| `host/chrome/profile/` | Readying the profile: moving it from where 0.2 kept it, its preferences, the shared native apps, and what earlier versions left. | nothing |
| `host/chrome/pages/` | The pages: the page model and the registry. | `cdp` |
| `host/chrome/` | `ctx.chrome`: Chrome, its screen, its pages, the agent's help requests. | its parts above, `platform` |
| `host/page-operations/` | What can be done with a page: snapshots and refs, actions, text, screenshots, dialogs, addresses. | `chrome/pages`, `chrome/cdp` |
| `host/viewer/` | The sidebar's routes: the screen bridge, the viewer connection, the screen's layout. | `protocol`, `platform`, `chrome`, `page-operations` |
| `host/tools/`, `host/context/` | The agent's tools and the turn-start reading. | `chrome` and its pages, `page-operations` |
| `host/index.ts` | The main Loader row: the configuration, `ctx.chrome` and the viewer. | `platform`, `chrome`, `viewer` |
| `client/screen/` | Chrome's screen in the tab (noVNC), and the user's keys and text for it. | nothing |
| `client/viewer/` | The tab's connection to dsh-chrome: Chrome's state, the screen's owner, help requests. | `protocol` |
| `client/` | The tab type and its body. | `protocol`, `screen`, `viewer` |

[test/unit/dependencies.test.ts](../test/unit/dependencies.test.ts) defines which part may
import which, and fails on an import outside that.

## Processes and channels

```
DSH Host (Node)                                   the screen, one per DSH home
  dsh-chrome          ── pipe (CDP) ───────────────  Chrome ── X11 ── Xvnc ── Openbox
  dsh-chrome-tools                                                      │
  dsh-chrome-context  ── screen bridge ── VNC Unix socket ──────────────┘

DSH web client (Desktop window, or any browser signed in to DSH)
  Chrome sidebar tab  ── screen WebSocket (VNC) ─────┐  admitted like DSH's /api
                      ── viewer WebSocket (JSON) ────┴─ dsh-chrome (Host)
```

* **No debugging port.** Chrome is started with `--remote-debugging-pipe`: CDP travels as
  NUL-delimited JSON over its file descriptors 3 and 4, which only dsh-chrome holds, and
  Chrome exits when the pipe closes. Pages are reached in flattened sessions: the registry
  auto-attaches to page targets and holds each new one at its start until it has turned its
  dialogs' events on. Holding it also matters for input: without it, Chrome leaves the mouse
  release that opens a popup window unanswered, and the input after it with it.
* **Not announced as automated.** Chrome takes a browser debugged through a pipe for one
  under automated control, and tells pages so (`navigator.webdriver`, the Blink feature
  `AutomationControlled`). Google's sign-in then refuses the browser ("This browser or app
  may not be secure"), and bot checks of other sites fail, even while the user works by
  hand. dsh-chrome turns the feature off (`--disable-blink-features=AutomationControlled`)
  unless `announceAutomation` is set: the Chrome is the user's as much as the agent's, and
  the agent acts in the user's sessions, on their behalf, at a person's pace. Chrome warns of
  any `--disable-blink-features` with a bar in its first tab at each start ("unsupported
  command-line flag"); only a managed policy turns the warning off, so it stays.
* **The desktop.** Chrome keeps the user's session bus (D-Bus), where it finds the keyring
  that encrypts the profile's cookies and passwords. Through it, Chrome also asks the
  desktop for its file chooser (the desktop portal) and shows site notifications there:
  those appear on the host machine's own screen, not on dsh-chrome's.
* **The screen.** Xvnc takes a free display number (`-displayfd`) and serves VNC on a Unix
  socket only (`-rfbport -1 -nolisten tcp`), without a password, in a runtime directory only
  the user can enter, one per DSH home. As an X server, it admits only the programs that show
  the cookie written for it into that directory (`-auth`, `XAUTHORITY`): Openbox and Chrome.
  Without one, Xvnc admits any local X client, of any user, on the X socket every user can
  open, and that would reach Chrome's screen and input around the VNC socket's directory.
  The X server keeps the screen in memory, so it works while the machine's own screen is
  locked or off. Openbox maximizes Chrome's windows without
  decorations, and Chrome draws no frame of its own (`browser.custom_chrome_frame: false` in
  the profile's preferences), so the screen shows the window and nothing else. A window a
  page opens stays centred above, with a title bar whose only button closes it: without a
  taskbar, a window gone behind another could not be found again. Openbox has no keys of its
  own, so every key reaches Chrome.
* **The screen bridge** carries each viewer's VNC stream between its WebSocket and the VNC
  socket, byte for byte, as websockify does. A viewer that cannot keep up holds the socket's
  reading back, rather than the Host buffering frames for it. The host holds a VNC connection
  of its own, to set the screen's size (`SetDesktopSize`).
* **The viewer WebSocket** carries JSON messages (`src/protocol/viewer.ts`), parsed into
  fresh values with the protocol's fields only on each side.
* **Processes.** Chrome is spawned directly, since DSH's subprocess service cannot give it
  file descriptors 3 and 4. Xvnc and Openbox would outlive a DSH that crashed, so their pids
  are recorded in the runtime directory, and the next start ends those that still run for it,
  and waits until they have: an Xvnc that ended late would remove its socket's path from the
  one started after it.
* **Starting.** The screen starts when a viewer connects to it, and Chrome when a Chrome tab
  opens (it asks once, as it first connects), when the user asks, or when a tool needs it. A
  viewer that connects again, after a drop or while it was hidden, starts nothing, so a Chrome
  the user closed stays closed.

## The screen

The screen has the owner's area, in CSS pixels, times the device scale factor (2), and Chrome
draws at that factor (`--force-device-scale-factor`). A CSS pixel of the viewer thus takes as
many of the screen's pixels as a CSS pixel of Chrome: Chrome looks as large as a page in the
viewer would, and on a high-density display the screen is drawn pixel for pixel. Openbox
resizes Chrome's window with the screen. Chrome keeps its windows at least 500 CSS pixels
wide, so a narrower viewer gets a screen that wide, in proportion, which it shows scaled to
fit. Every other viewer shows the screen scaled to fit as well, until it takes the screen:
the owner is the viewer that most recently came into view or got the user's input, and when
it leaves, the one that owned the screen before it takes over. Before any viewer gives its
size, the screen is 1280 × 800.

A tab that is not in view (a hidden sidebar tab, a background browser tab) closes its
screen WebSocket, and Xvnc sends nothing to it; its viewer WebSocket stays open, so it comes
back at once. Passing notices float over the screen, since notices in the layout would
resize it, and Chrome would lay its page out anew, as they come and go.

## Input

The user's pointer, touches included, goes to the screen as noVNC sends it: Xvnc turns it
into X input, which Chrome takes as a mouse's. Clicks and double clicks are the user's own.

Keys go through a text field over the screen, which the view focuses when the user presses
it. A key goes to the screen as the X keysym of what it is on the user's own keyboard
(`routeKey`): its name, or the character it types, so that the user's layout decides what a
key means, not the screen's, and Xvnc presses whichever of its keys carries the keysym. A
shortcut (Ctrl, ⌘ on macOS, or Alt elsewhere) goes by the key's letter, or on a layout
without Latin letters by the US key's, so that Ctrl+C copies on a Russian keyboard too. On
macOS, ⌘ is pressed as Ctrl, so that shortcuts work as there. A character that AltGr or
Option chose is typed as that character, with the modifiers held let go of around it: X
would otherwise read Windows' Ctrl+Alt for AltGr as a shortcut. Keys typed into Chrome do
not reach DSH's own shortcuts; keys the user's browser keeps for itself (Ctrl+T, Ctrl+W in
Chrome) never reach the view.

Text that an input method composes (Japanese conversion, a phone's keyboard) shows in the
field until it is done, then goes to the screen. ASCII, and a single character, go as keys;
longer text with any other character goes as a paste: the view gives the screen the text as
its clipboard and presses Ctrl+V, with the modifiers held let go of, in the same VNC stream
as the keys, so the text arrives in order, in the page or in Chrome's own UI alike. Keys
would not do for such text: Xvnc gives a character outside its keymap a spare key, and
reuses its few spare keys in turn, so a burst of new characters takes a key back before
Chrome reads its first press. Typed as keys in one burst, 402 of 416 distinct characters
arrived as others; one character at a time, as a person types, leaves Chrome the time to
read each.

Xvnc tells the viewers when Chrome's clipboard changes, but not of each selection (X's
PRIMARY selection, `-SendPrimary=0`). The view takes the new clipboard for the user's own
only within two seconds of the user's last press or key in it: a copy without one was the
agent's, or a page's on its own. The paste shortcut pastes the user's own clipboard, which
the browser hands the field, or Chrome's own when the user's last copy in Chrome could not
reach theirs (a browser that refuses the view the clipboard).

## The agent

A session's agent may use the pages it opened, the pages those opened, and the pages that
belong to no session: those the user opened in Chrome. It may read and operate web pages
only: not Chrome's own pages (`chrome:`, its settings and saved passwords), extensions' pages
or local files, even those the user opened, which CDP would reach. A page of no session becomes the
session's once its agent uses it, so that the agent of another session does not. Tools act
on the page they name, or else on the page in front if the session may use it, or else on
the page the session used last, and their commands end when the tool call is stopped.
`chrome_open` opens a blank tab, in front, and loads the address in it, so that it can wait
for the load from its start.

An action brings its page to the front first, as the user would: Chrome shows the dialogs of
the page in front only, and answers the others' itself. It ends as soon as the page opens a
dialog: the command that caused the dialog gets no answer until someone answers it. The
result names the dialog, and the pages the action opened; the agent answers with
`chrome_answer_dialog`, and a page showing a dialog refuses the tools that read or operate it
until then. An action waits a moment after it for the pages it opened, which Chrome reports
shortly after the action itself. The agent reads a page as an accessibility tree with refs
(`e42`, Chrome's backend DOM node ids) and acts by ref with trusted input. Backend node ids
are unique only within a renderer process, so refs belong to the document their snapshot was
read from: once the page shows another document, they no longer resolve, and the agent takes
a new snapshot.

Chrome does not report every change of a page's title as it happens, so titles are brought
up to date (`Target.getTargets`) before they are shown: in tool results, the reading, and the
help request. Whether a page is in view is asked in a world of dsh-chrome's own in the page
(`Page.createIsolatedWorld`): in the page's main world, its scripts could redefine
`document.hasFocus` and pass for the page the user looks at.

Snapshots, page text and screenshots reach the model marked untrusted; titles are quoted and
shortened wherever they appear. Sensitive input is the user's: the agent asks with
`chrome_ask_user`, which brings the page to the front and shows the request above Chrome in
the session's tabs, and waits. The tools refuse pages that show DSH's own web UI in any
frame, by the addresses DSH serves: in a profile signed in to DSH, the agent could otherwise
approve its own actions, and DSH's cookie reaches frames of the same site. DSH would close
this off for every page by forbidding framing (`frame-ancestors 'self'`), which it does not
yet.

The reading at the start of a turn lists the pages the session may use and the one the user
is looking at, only when that changed and only for a turn that has something to do, so cached
prompt prefixes stay valid. Its addresses lose their query and fragment, which often carry
tokens: the reading enters every turn unasked. Tool results keep whole addresses, which the
agent asked for and may need.

## Trust boundaries

* The pipe gives whoever holds it full control of Chrome, and only the DSH Host holds it.
  dsh-chrome sends only the commands in `CDP_COMMANDS`, which the connection's types admit
  and which it checks again at run time. The agent's tools reach web pages only: addresses
  are web addresses (`normalizeAddress`), scripts run in the page's main world, and no command
  reads cookie stores, network traffic, the worlds of extensions, or local files.
* The VNC socket gives whoever reaches it Chrome's screen and input, without a password.
  Only the user's own processes can enter its directory, which must be the user's and in a
  directory of the user's; other users and the network cannot reach it, and DSH's route
  admits only the browsers DSH authenticates. The X server admits only the programs given
  its cookie. Whoever can use the DSH web UI can therefore use Chrome, with its sign-ins, as
  they can use DSH's terminal.
* The screen bridge passes VNC through without reading it: Xvnc on the host and noVNC in
  the viewer parse it. Each viewer message is parsed into fresh values.
* noVNC runs in DSH's web client, at a fixed version, bundled into the plugin's module. A
  patch removes its one top-level `await`, which DSH's module loader cannot run.
* Earlier versions' files are removed only where they are theirs: a relay manifest only when
  it names this home's relay, so another DSH home's stays.

## Decisions to revisit

* One Chrome per DSH home, shared by every session. When the user and the agents work at
  once, they take the front in turns, and Chrome answers the dialogs of a page not in front.
* One screen size: viewers of different sizes take it in turns.
* Windows have no taskbar, so a second Chrome window covers the first. A window list in the
  tab's toolbar could switch between them.
* Text beyond ASCII is pasted, and replaces the screen's clipboard. Putting the clipboard back
  would need to know when Chrome has read it.
* A composition shows at the bottom of the tab, away from Chrome's caret.
* The screen carries no sound.
* Pages are not told that Chrome is automated, so sites cannot tell the agent's actions from
  the user's either. Telling them (`announceAutomation`) would keep the user from signing in
  to Google; a mode in which Chrome runs without the pipe, while the user signs in, would tell
  them honestly at every other time, at the cost of the agent waiting meanwhile.
* Pages get no WebGL: the screen has no GPU, and Chrome no longer falls back to drawing WebGL
  in software. `--enable-unsafe-swiftshader` would turn that back on, and with it a software
  GPU running shader code from any page, which Chrome turned off for that reason.
* `chrome_screenshot` shows the agent a page, not the screen: it does not see Chrome's own UI.
* The tools look for DSH in a page's frames through the page's frame tree, which leaves out
  frames of another site, drawn by another process. DSH's cookie does not reach those today
  (`SameSite`); checking the frames' own targets would close the gap for good.
* Two pastes within one round trip to the screen could take each other's text: noVNC hands
  Xvnc the clipboard's text only when Chrome asks for it. Pastes come from input methods'
  compositions and the user's own pastes, far apart at a person's pace.
* Keys stay in the view: Tab and Escape go to Chrome, so the keyboard alone does not leave it.
* A page's file chooser opens on the host's desktop. Intercepting it
  (`Page.setInterceptFileChooserDialog`) would let the user choose files in the sidebar, from
  the device that shows DSH, and the page would get them through `DOM.setFileInputFiles`.
* Pages belong to the session whose agent opened them, so a subagent's pages are not its
  parent's.
* Pages do not survive Chrome's restart, nor DSH's, since Chrome ends with the plugin.
* Chat links still open in DSH's own Browser tab; dsh-chrome does not take over the
  `browser` tab kind. A Chrome tab opened with a `url` navigation parameter opens that
  address.
* All tools are always declared to the model. Revealing them only when needed (a skill, or
  deferred loading) would shorten every prompt.
