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

Since 0.4, each DSH session has its own windows of that Chrome, on its own part of the
screen: its sidebar shows that part, its agent opens its pages there, and sessions shown at
once, in two browser windows or on two devices, do not take each other's view. Before, every
session showed the one Chrome window, laid out for whichever viewer the user looked at last.

## Concepts

| Concept | Meaning | In code |
|---|---|---|
| **Chrome** | The one Chrome dsh-chrome runs for a DSH home, controlled over the pipe it is started with. It opens no window of its own. It starts when a session opens a window (its Chrome tab opens, the user asks, or a tool needs it), and runs until the plugin stops, the user quits it, or the settings or a profile copy restart it. | `ChromeService`, `launchChrome` |
| **Profile** | dsh-chrome's Chrome user data directory, private to the user. Its extensions reach the native apps of the user's own Chrome through linked manifests. The user may replace it with a copy of a profile of their own Chrome. | `src/host/chrome/profile/` |
| **Screen** | Where Chrome draws: Xvnc, with Openbox keeping each Chrome window filling the monitor it is on. It serves VNC on a Unix socket, is laid out as the sessions' screens, and outlives Chrome's restarts. | `Display`, `startDisplay` |
| **Session screen** | A DSH session's part of the screen while a view shows the session: a monitor, as X and Chrome see it, beside the other sessions' monitors, with its size set by the session's viewer. The session's windows are on it. | `SessionScreens`, `Monitor` |
| **Parking monitor** | The monitor that the windows of every session no view shows share, at the right of the session screens, while any has a window. | `SessionScreens.parkingMonitor` |
| **Viewer** | One Chrome tab of DSH's sidebar, connected over two WebSockets: the screen's (VNC) and the viewer's (state and requests). It shows its session's screen. Several viewers of a session, of one browser or of several (Desktop and a phone), show the same session screen. | `ViewerConnection`, `ViewerSession`, `ScreenConnection` |
| **Screen owner** | The viewer whose size its session's screen has: of the session's viewers, the one the user last looked at or worked in. | `ScreenOwnership` |
| **Page** | A tab or window of Chrome, followed over CDP. It belongs to the DSH session whose agent opened it, or that of the page that opened it; one the user opened belongs to the session whose screen its window is on. | `ChromePage`, `PageRegistry` |
| **Page in front** | Of a session's pages, the one the user looks at in its view: one that shows a dialog, else the focused one, else one in view. | `PageRegistry.pageInFront` |
| **Keyboard focus** | The one window of the screen that gets keys. A key the user types in a session's view goes to that session's windows: the host gives them the focus first. | `KeyboardFocus`, `XConnection` |
| **Settings** | What the user changes in DSH's plugin settings while dsh-chrome runs: the volatile fields of the host plugin's configuration schema. Chrome takes them when it starts. | `Config` in `src/host/index.ts`, `ChromeSettings`, `SettingsPage` |
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
| `host/chrome/display/` | The screen: Xvnc and its cookie, the window manager, the screen's layout of monitors, the host's own X connection, its private directory, the record of its processes. | `platform` |
| `host/chrome/process/` | Starting Chrome on the screen, with the pipe. | `platform`, `cdp` |
| `host/chrome/profile/` | Readying the profile: moving it from where 0.2 kept it, its preferences, the shared native apps, what earlier versions left, and copying a profile of the user's own Chrome. | nothing |
| `host/chrome/pages/` | The pages: the page model and the registry. | `cdp` |
| `host/chrome/sessions/` | The sessions' parts of the screen, and the keyboard they share. | `platform`, `display` |
| `host/chrome/` | `ctx.chrome`: Chrome, its screen, its pages and their sessions' windows, the agent's help requests. | its parts above, `platform` |
| `host/page-operations/` | What can be done with a page: snapshots and refs, actions, text, screenshots, dialogs, addresses. | `chrome/pages`, `chrome/cdp` |
| `host/viewer/` | The sidebar's routes: the screen bridge and the viewer's VNC messages it reads, the viewer connection, and which viewer each session's screen is laid out for. | `protocol`, `platform`, `chrome`, `page-operations` |
| `host/tools/`, `host/context/` | The agent's tools and the turn-start reading. | `chrome` and its pages, `page-operations` |
| `host/index.ts` | The main Loader row: the configuration schema, `ctx.chrome` and the viewer. | `platform`, `chrome`, `viewer` |
| `client/screen/` | The session's part of Chrome's screen in the tab (noVNC), and the user's keys and text for it. | `protocol` |
| `client/viewer/` | The tab's connection to dsh-chrome: Chrome's state, the session's screen and windows, help requests. | `protocol` |
| `client/settings/` | dsh-chrome's page in DSH's plugin settings: the form drawn from the host's schema, and the profile copy. | `protocol` |
| `client/` | The tab type and its body, and the settings page's registration. | `protocol`, `screen`, `viewer`, `settings` |

[test/unit/dependencies.test.ts](../test/unit/dependencies.test.ts) defines which part may
import which, and fails on an import outside that.

## Processes and channels

```
DSH Host (Node)                                   the screen, one per DSH home
  dsh-chrome (ctx.chrome)  ── pipe (CDP) ──────────  Chrome ── X11 ── Xvnc ── Openbox
                           ── X11 (the keyboard's focus) ────────────────┤
  dsh-chrome (viewer)      ── screen bridge ── VNC Unix socket ──────────┘
  dsh-chrome-tools, dsh-chrome-context  ── ctx.chrome

DSH web client (Desktop window, or any browser signed in to DSH)
  Chrome sidebar tab  ── screen WebSocket (VNC) ─────┐  admitted like DSH's /api
                      ── viewer WebSocket (JSON) ────┤
  dsh-chrome's page in the plugin settings ──────────┴─ dsh-chrome (Host)
                      ── DSH's settings service ──────── the Loader row's configuration
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
  any `--disable-blink-features` with a bar in the window it opens at its start ("unsupported
  command-line flag"), which only a managed policy turns off; since Chrome opens no window of
  its own (below), the bar does not show.
* **No window of its own.** Chrome starts with `--no-startup-window`: each session opens its
  windows on its own part of the screen. Chrome then also stays up when every window closes.
* **WebGL.** The screen has no GPU, so Chrome finds no OpenGL to draw with, and turns WebGL
  off. Through Vulkan (`--use-angle=vulkan`, the `webgl` setting's `gpu`), ANGLE reaches the
  machine's GPU without the screen, and its frames still reach the screen (checked on an
  NVIDIA GPU, with the driver's Vulkan). `gpu-or-cpu` adds
  `--ignore-gpu-blocklist`, so that a machine without a Vulkan GPU driver draws WebGL on the
  CPU (Mesa's lavapipe or llvmpipe), which Chrome refuses by itself: slower, and a larger
  target for a hostile page's shaders. `--enable-unsafe-swiftshader` would do as much with
  Chrome's own software renderer. None of these flags brings Chrome's warning bar.
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
  locked or off. Openbox maximizes Chrome's windows on their monitors without
  decorations, and Chrome draws no frame of its own (`browser.custom_chrome_frame: false` in
  the profile's preferences), so a session's screen shows its window and nothing else. A
  window a page opens stays above, where Chrome puts it (on its opener's monitor), with a
  title bar whose only button closes it: without a taskbar, a window gone behind another
  could not be found again. Openbox has no keys of its own, so every key reaches Chrome.
* **The screen bridge** carries each viewer's VNC stream between its WebSocket and the VNC
  socket, as websockify does: the screen's bytes to the viewer unchanged, and the viewer's
  messages, which it reads (`ClientStream`), in order. It holds a key until the viewer's
  session has the keyboard's focus, and drops a change of the screen's layout
  (`SetDesktopSize`): the host lays the screen out. A viewer that cannot keep up holds the
  socket's reading back, rather than the Host buffering frames for it. The host holds a VNC
  connection of its own, to lay the screen out (`SetDesktopSize`, with one screen for each
  session), and an X connection of its own, with the screen's cookie, to read and give the
  keyboard's focus (`XConnection`: `GetInputFocus`, `SetInputFocus`, a window's place).
* **The viewer WebSocket** carries JSON messages (`src/protocol/viewer.ts`), parsed into
  fresh values with the protocol's fields only on each side.
* **Processes.** Chrome is spawned directly, since DSH's subprocess service cannot give it
  file descriptors 3 and 4. Xvnc and Openbox would outlive a DSH that crashed, so their pids
  are recorded in the runtime directory, and the next start ends those that still run for it,
  and waits until they have: an Xvnc that ended late would remove its socket's path from the
  one started after it.
* **Starting.** The screen starts when a viewer shows a session, and Chrome when a session
  opens a window: when its Chrome tab opens (it asks once, as it first connects), when the
  user asks, or when a tool needs it. A viewer that connects again, after a drop or while it
  was hidden, opens nothing, so a window the user closed stays closed.

## The sessions' screens

The screen is laid out as monitors side by side, as X's RandR shows monitors to the programs
on the screen: Chrome places a window where its monitor is, and Openbox maximizes a window on
the monitor it is on. Each session that a view shows has a monitor of its own: it keeps it (a
slot, and the monitor's id) while a view shows it; then the slot is free for the next session,
and the last free slots go. The windows of the sessions no view shows, those whose agents work
in Chrome unseen, subagents' included, share one monitor at the right, the parking monitor,
while any has a window: they need no room of their own until someone looks. When a view shows
such a session, its windows move to its own monitor; when its last view goes, they go back to
the parking monitor. A session's viewer shows its monitor only: noVNC is patched to show one
rectangle of the screen, scaled to the view, to ask Xvnc for that rectangle's pixels only, and
to keep the pointer in it, so that a drag does not reach another session's windows
(`viewRegion`).

A session's monitor has its owner viewer's area, in CSS pixels, times the device scale factor
(2), and Chrome draws at that factor (`--force-device-scale-factor`). A CSS pixel of the viewer
thus takes as many of the screen's pixels as a CSS pixel of Chrome: Chrome looks as large as a
page in the viewer would, and on a high-density display the screen is drawn pixel for pixel.
Chrome keeps its windows at least 500 CSS pixels wide, so a narrower viewer gets a monitor
that wide, in proportion, which it shows scaled to fit. The session's other viewers show the
monitor scaled to fit as well, until one takes it: the owner is the session's viewer that most
recently came into view or got the user's input, and when it leaves, the one that owned the
monitor before it takes over. Until a viewer gives its size, a session's monitor is 1280 × 800
CSS pixels, and so is the parking monitor. A Chrome started at another scale factor gets the
monitors sized at it.

Xvnc makes no screen wider than 16384 pixels, so the monitors of the sessions shown at once
fit side by side in that, with the parking monitor: some five at the default size, more at a
sidebar's. A session's view that would not fit gets no monitor, and says so.

The window manager does not keep a window on its monitor by the monitor's id: as monitors
grow, shrink and move, it moves a window to the monitor it overlaps most, which can be
another session's. After each change of the layout, the Chrome service looks at each
session's windows, twice, as Openbox settles, and puts a window back on its session's monitor
when its middle is on another: a maximized one fills the monitor again, a popup goes to the
monitor's top left corner. Until then, a window can show in another session's view for a moment.

A session's first window opens on its monitor, or the parking monitor (`Target.createTarget`
with the monitor's bounds, without the focus); a page the agent or the user opens for the
session later opens as a tab of the session's front window. Chrome opens a new tab in the
window it last had the focus in, so the session's window takes the focus first, and the tab is
checked to be in it: one that went to another window (the user clicked elsewhere meanwhile)
is closed again, and a window opens instead. Chrome may not know of a monitor just added, and
put a window on another: then it is moved to its monitor. A page opens blank, and goes to its
address only once it is in its place, so that a tab that went astray never loads it. Openings
go one at a time, and while one is under way no page Chrome reports is given a session by its
window's place: Chrome reports a target before it answers the command that created it, and
the command's claim, made once it answers, says whose the page is.

A tab that is not in view (a hidden sidebar tab, a background browser tab) closes its
screen WebSocket, and Xvnc sends nothing to it; its viewer WebSocket stays open, so it comes
back at once. Passing notices float over the screen, since notices in the layout would
resize it, and Chrome would lay its page out anew, as they come and go.

## Input

The user's pointer, touches included, goes to the screen as noVNC sends it, in the view's
region: Xvnc turns it into X input, which Chrome takes as a mouse's. Clicks and double clicks
are the user's own.

The screen has one keyboard focus, for every session's windows, and a session's window can
take it while the user types in another session's view: the agent's action in a window brings
it Chrome's focus (see below), and a window a page opens takes it. So the screen bridge holds
each key until the viewer's session has the focus: the host asks the X server which window has
it, and where that window is (its middle, on which session's monitor); if it is another
session's, the host gives the focus back to the session's window that had it last
(`SetInputFocus`), or else has Chrome bring the session's front window forward and waits until
it has the focus. Only then does the key go to Xvnc, which hands it to the focused window.
Keys pass one at a time, so that two views typed in at once each get their own. A check takes
a few round trips to the X server, well under a millisecond; a key that comes while the focus
moves elsewhere at the same moment could still go astray, but the agent's actions and popups
take Chrome a few milliseconds to bring a window forward, and Xvnc reads a key within
microseconds. A session whose window does not take the focus when Chrome is asked (its window
is moving between monitors, say) is not asked again for a few seconds: its keys go where the
focus is meanwhile, rather than every session's keys waiting behind it. A viewer that is gone
drops the keys it left waiting. The host opens its X connection again whenever it closes;
until it does, keys go where the focus is.

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

A session's agent may use the session's pages: those it opened, those the user opened in the
session's windows, and those they opened; and the pages of no session (on no session's
monitor, which only a window Chrome itself put elsewhere can be). It may read and operate web
pages only: not Chrome's own pages (`chrome:`, its settings and saved passwords), extensions'
pages or local files, even those the user opened, which CDP would reach. A page of no session
becomes the session's once its agent uses it, so that the agent of another session does not.
Tools act on the page they name, or else on the session's page in front, or else on the page
the session used last, and their commands end when the tool call is stopped. `chrome_open`
opens a blank tab in front, in the session's window, and loads the address in it, so that it
can wait for the load from its start.

An action makes its page the active tab of its window, where the session's view shows it, and
gives the window Chrome's focus, as the user would by clicking in it: without the focus, Chrome
edits no text for the keys it is sent (a Backspace deletes nothing). The user's own keys still
go to the session they type in, as above. A dialog of a page that is not in front, or in a
window without the focus, stays open, and answerable, while the user works elsewhere. An
action ends as soon as the page opens a dialog: the command that caused the dialog gets no
answer until someone answers it. The
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
`chrome_ask_user`, which shows the page in its window and the request above Chrome in the
session's tabs, and waits. The tools refuse pages that show DSH's own web UI in any
frame, by the addresses DSH serves: in a profile signed in to DSH, the agent could otherwise
approve its own actions, and DSH's cookie reaches frames of the same site. DSH would close
this off for every page by forbidding framing (`frame-ancestors 'self'`), which it does not
yet.

The reading at the start of a turn lists the pages the session may use and the one the user
is looking at, only when that changed and only for a turn that has something to do, so cached
prompt prefixes stay valid. Its addresses lose their query and fragment, which often carry
tokens: the reading enters every turn unasked. Tool results keep whole addresses, which the
agent asked for and may need.

## Settings

The host plugin's configuration schema (`Config` in `src/host/index.ts`) is the one
definition of dsh-chrome's settings. The settings a user changes while dsh-chrome runs are
volatile fields (`.volatile()`): `executable`, `deviceScaleFactor`, `announceAutomation`,
`webgl` and `shareNativeHosts`. The plugin reads every volatile field of the schema as a
setting Chrome takes; their type (`ChromeSettings`) is checked against the schema when the
code compiles. DSH's settings service serves a form of each running row's
volatile fields, with their part of the schema (its JSON form), and writes edits into the
DSH profile's configuration; the Loader then updates the values the plugin holds
(`Setting.get()`) without restarting it, and tells the row (`loader/volatile-update`). The
other fields (paths, the programs behind the screen) stay in the configuration file, and
changing one restarts the plugin, as for any field. The Loader tells the row only, and a row
reaches only the services it injects, so the row passes the change on to `ctx.chrome`, which
it provides, through the service's configuration.

The browser client registers a page for the row in DSH's Plugins page (the
`plugins.row.config` slot, keyed `<package>#<row id>`), and draws its form from the schema the
settings service serves: a checkbox for a boolean, a number or text field with the schema's
bounds, a choice of the union's constants with their descriptions, and the descriptions as
help; a field of another type is shown as one to set in the configuration. Adding a setting
to the schema adds it to the page. DSH 0.2.1-rc.2 ships no such form, and no types of its
settings services, so the client declares the few it uses.

Chrome reads the settings when it starts. While it runs with others, the sidebar says so and
offers to restart it, which closes every session's windows: a restart is the user's choice.

## Copying a profile

The settings page can replace dsh-chrome's profile with a copy of a profile of the user's own
Chrome (`userChromeDir`), listed from its `Local State`. The copy keeps what the profile
keeps of the user: sign-ins, saved passwords, bookmarks, history, extensions and their data,
site data and settings. Chrome on Linux encrypts cookies and passwords with a key the user's
keyring keeps for every Chrome of the user ("Chrome Safe Storage"), so dsh-chrome's Chrome
reads them: dsh-chrome's Chrome read 5834 of the 5977 cookies of a copied real profile, 5806
of them with their values.

The copy leaves out what Chrome fills again (caches), the open windows and tabs, which
dsh-chrome's Chrome would otherwise restore, and what makes the profile a device of the
user's account: Chrome Sync's data and identity (`sync.transport_data_per_account`, with
its `cache_guid`), and the push messaging registration (`GCM Store`), so that the copy joins
Sync as a device of its own rather than as the same one twice. It marks the profile as closed
cleanly, which a running Chrome's is not, so that Chrome offers no restore.

The user's Chrome may run meanwhile. A SQLite database it writes while it is copied can be
torn, so each database is copied again with its journal, the journal first, and checked
(`PRAGMA integrity_check`, after the journal is played back), until a copy is whole; a
transaction the user's Chrome makes meanwhile can still be half in a copy that is whole, so
the confirmation suggests closing it first. Chrome's other stores (LevelDB) are copied as
they are, and may miss what Chrome has not written yet. The copy is made beside the profile,
under a name of its own, while dsh-chrome's Chrome runs; Chrome then closes, the copy takes the
profile's place, and the profile it replaced stays beside it (`Default.before-copy`) until the
next copy. Chrome starts again when a session opens a window, and starts wait meanwhile. A
plugin that stops (DSH restarts it, say) stops its copy, which leaves nothing behind and does
not take the profile's place: the plugin that starts after it removes what an unfinished copy
left.

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
* The screen bridge reads only how the viewer's stream divides into messages, and which are
  keys or changes of the layout; Xvnc on the host and noVNC in the viewer parse the rest. A
  stream that is not VNC, or a message longer than a viewer sends, closes the viewer. Each
  viewer socket message is parsed into fresh values.
* The host's X connection shows the screen's cookie, as Openbox and Chrome do, and asks only
  for the keyboard's focus and windows' places, and gives the focus. A failure of it, at any
  moment, ends in a rejection the host handles: DSH exits on one that is not.
* A viewer's keys go to its session's windows only: the screen bridge knows the viewer's
  session from its socket's address, which any viewer DSH admits may name. Sessions are not a
  boundary between people: whoever can use the DSH web UI can use every session.
* The profile copy reads the user's own Chrome's user data directory and writes only beside
  dsh-chrome's profile; it copies a profile the user's `Local State` lists, by its directory's
  name, and nothing outside it.
* The settings page reads and writes the settings through DSH's settings service, as DSH's own
  pages do, and lists and copies profiles over the viewer socket.
* noVNC runs in DSH's web client, at a fixed version, bundled into the plugin's module. A
  patch removes its one top-level `await`, which DSH's module loader cannot run, and adds the
  view of one region of the screen.
* Earlier versions' files are removed only where they are theirs: a relay manifest only when
  it names this home's relay, so another DSH home's stays.

## Decisions to revisit

* One Chrome per DSH home, with one profile, shared by every session; sessions have their own
  windows. The agents' actions take the keyboard's focus in turns with the user's keys: a
  page that closes a menu when its window loses the focus closes it as the user types in
  another session's view.
* The monitors of the sessions shown at once stand side by side in Xvnc's 16384 pixels, with
  the parking monitor: some five at the default size. Rows of monitors would make room for
  more, at the cost of a larger screen in memory.
* After a change of layout, a window can show in another session's view until it is put
  back, a fraction of a second.
* A session's windows have no taskbar, so a second window of the session covers the first. A
  window list in the tab's toolbar could switch between them.
* Settings apply when Chrome starts again, which closes every session's windows. Chrome could
  restore them (`--restore-last-session`), each on its session's monitor, at the cost of
  reopening pages the user may have meant to leave.
* Text beyond ASCII is pasted, and replaces the screen's clipboard. Putting the clipboard back
  would need to know when Chrome has read it.
* A composition shows at the bottom of the tab, away from Chrome's caret.
* The screen carries no sound.
* Pages are not told that Chrome is automated, so sites cannot tell the agent's actions from
  the user's either. Telling them (`announceAutomation`) would keep the user from signing in
  to Google; a mode in which Chrome runs without the pipe, while the user signs in, would tell
  them honestly at every other time, at the cost of the agent waiting meanwhile.
* WebGL goes through Vulkan to the machine's GPU; a machine without a Vulkan GPU driver gets
  none, unless the user picks `gpu-or-cpu`, which draws it on the CPU, as Chrome refuses to by
  itself.
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
  parent's, and its windows are on a monitor of their own.
* A profile copy copies a running Chrome's LevelDB stores as they are; the user may close
  their Chrome first for an exact copy. It replaces the whole profile: copying what the user
  chose of it (sign-ins only, say) is left for later.
* Pages do not survive Chrome's restart, nor DSH's, since Chrome ends with the plugin.
* Chat links still open in DSH's own Browser tab; dsh-chrome does not take over the
  `browser` tab kind. A Chrome tab opened with a `url` navigation parameter opens that
  address.
* All tools are always declared to the model. Revealing them only when needed (a skill, or
  deferred loading) would shorten every prompt.
