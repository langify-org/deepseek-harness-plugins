# dsh-chrome design

dsh-chrome lets the user and the agent work on the same real Chrome page. The page lives in
a Chrome profile on the DSH host machine, so it keeps that profile's logins and extensions.
DSH's right sidebar shows the page and sends the user's input back; the agent reads and
operates the same page through tools.

The sidebar is therefore not a browser. It is a *viewer*: pixels come in, input goes out.
This is what lets the page keep real logins (a cross-site iframe never sees them, and an
embedded Electron webview has neither the profile nor native messaging for 1Password), and
what makes the page reachable from any device that opens the DSH web UI.

## Concepts

| Concept | Meaning | In code |
|---|---|---|
| **Connector** | The MV3 extension running in a Chrome profile, plus the native messaging relay that links it to DSH. All control of Chrome goes through a connector. | `src/extension/`, `src/native-host/` |
| **Profile** | A Chrome user data directory the connector may run in: `daily` (the user's own) or `dedicated` (one dsh-chrome starts). The relay reports which, because the plugin wrote it into that profile's relay launcher. | `ProfileName`, `connector-install.ts` |
| **Browser** | One connected Chrome profile, as the plugin sees it. | `ConnectedBrowser` |
| **Page** | A Chrome tab the plugin opened, owned by one DSH session. The connector controls only its pages; tools and viewers reach only their session's pages. | `ChromePage`, `PageRegistry`, `OwnedPages` |
| **Viewer** | One sidebar tab, connected to DSH, watching one session's pages and showing one of them. Several viewers (Desktop and a phone) may show the same page. | `ViewerConnection`, `ViewerSession` |
| **Screen** | The frames of one page for its viewers, and the page's layout. | `PageScreen` |
| **Viewport owner** | The viewer whose size the page is laid out at: the one that most recently attached or sent input. | `PageScreen.claimOwnership` |
| **Help request** | The agent asking the user to act on a page (sign in, enter a code), and waiting for the answer. | `HelpRequests` |
| **Reading** | What the agent is told about the session's pages at the start of a turn. | `src/host/context/` |

## Processes and channels

```
DSH Host (Node)                                   Chrome (daily or dedicated profile)
  dsh-chrome           ── connector socket ──      native host relay  ── native messaging ──
  dsh-chrome-tools        (Unix, user-only)        (Chrome starts it)     connector extension
  dsh-chrome-context                                                      └─ chrome.debugger → owned tabs

DSH web client (Desktop window, or any browser signed in to DSH)
  Chrome sidebar tab   ── viewer WebSocket, admitted like DSH's /api ──  dsh-chrome (Host)
```

* **No remote-debugging port.** Chrome 136 and later refuse `--remote-debugging-*` on the
  default profile, and a debugging port would expose the whole logged-in browser to every
  local process. The connector uses `chrome.debugger` on the tabs it opened.
* **The relay** passes Chrome's native messaging frames (a 32-bit length, then JSON) through
  unchanged. Chrome starts it only for the connector's extension id, which is fixed by the
  public key in the extension manifest. It reaches DSH over a Unix socket in a `0700`
  directory under `$XDG_RUNTIME_DIR`. Same-user processes are not isolated from each other.
* **The viewer route** is a WebSocket upgrade on DSH's web server, admitted by
  `ctx.connection.requestRejection` like DSH's `/api`. Desktop and remote browsers use the
  same path; no port is opened. Frames are binary messages; everything else is JSON.
* **The dedicated profile's Chrome** is started with `--remote-debugging-pipe` only to load
  the connector (branded Chrome ignores `--load-extension` since 137). The pipe belongs to
  dsh-chrome alone; control then goes through the connector, as for the daily profile.

## Frames and layout

A page emulates the viewport owner's size (`Emulation.setDeviceMetricsOverride`), so it lays
out for the screen the user is looking at. Chrome then sizes the page's render surface to
match, and screencast frames show exactly that viewport. When the window lays itself out
again (the debugging infobar appearing, the user resizing it), Chrome gives the surface the
window's size back; a frame of another size reveals that, and the layout is applied again.

While a viewer is on screen, the page is screencast: Chrome sends a frame whenever it
repaints. Whenever no frame has come for a while, the page is captured instead
(`Page.captureScreenshot`, which Chrome renders even for a page it does not show), and a
capture that repeats the last one is dropped. One rule covers every way a screencast falls
silent: a still page; a hidden page (a background tab, a minimized window), which Chrome
reports, so it is captured more often; and a window the system has stopped drawing, such
as on a locked screen. After a layout change, a capture follows shortly unless a frame
comes first.

A viewer holds at most one undelivered frame: the host sends the next frame only after the
viewer reports the last one drawn, and frames produced meanwhile replace each other. A
viewer that is not on screen (its sidebar tab hidden) gets no frames, and when no viewer of
a page is on screen, its screencast stops.

## Input

Pointer, wheel and key events become trusted CDP input events in page coordinates. Text
from input methods (Japanese conversion, phone keyboards, paste) is composed in the viewer
and inserted when finished (`Input.insertText`): Chrome's own input method is not involved,
so composition works the same from any device. Mouse moves are coalesced so that a fast
pointer never queues behind the events that matter.

## The agent

Tools act on the session's most recently used page unless they name one, and their
commands end when the tool call is stopped. The agent reads a page as an accessibility tree
with refs (`e42`, Chrome's backend DOM node ids) and acts by ref with trusted input, like
the user's hands. Backend node ids are unique only within a renderer process, so refs
belong to the document their snapshot was read from: once the page shows another document,
they no longer resolve, and the agent takes a new snapshot.

Snapshots, page text and screenshots reach the model marked untrusted; titles are quoted and
shortened wherever they appear. Sensitive input is the user's: the agent asks with
`chrome_ask_user` and waits. The tools refuse DSH's own web UI, by the addresses DSH
serves: in a profile signed in to DSH, the agent could otherwise approve its own actions.

The reading at the start of a turn lists the session's pages and the one the user is
looking at, only when that changed and only for a turn that has something to do, so cached
prompt prefixes stay valid. Its addresses lose their query and fragment, which often carry
tokens: the reading enters every turn unasked. Tool results keep whole addresses, which the
agent asked for and may need.

## Trust boundaries

* The connector refuses tabs it did not open, and passes on only the CDP methods and events
  dsh-chrome uses (`CONNECTOR_CDP_METHODS`, `CONNECTOR_CDP_EVENTS`); the host's CDP types are
  narrowed to the same lists. Cookie stores and network traffic, which carries cookies and
  credentials, stay out of reach, of a compromised host and of a process posing as DSH.
* Chrome limits host-to-extension messages to 1 MiB and closes the port on a larger one, so
  every request's size is checked before it is sent.
* Each side parses the other's connector and viewer messages into fresh values with the
  protocol's fields only. CDP results are typed by `devtools-protocol` and trusted as Chrome's.

## Decisions to revisit

* Pages open in one agent window per browser, grouped per session. Only the active tab of a
  window is rendered by Chrome, so other shown pages of that window fall back to captures.
* Tabs that a page opens itself (sign-in popups, links with `target=_blank`) are not owned:
  they stay out of the sidebar and the tools. Adopting a tab whose opener is owned would
  bring them in.
* Pages belong to the session whose agent opened them, so a subagent's pages are not shown
  in its parent's sidebar.
* A sidebar tab follows pages the agent opens, so every Chrome tab of a session switches to
  the agent's new page.
* Pages do not survive a Chrome restart. After a DSH restart, the plugin adopts the pages a
  still-running connector reports, under the session ids it recorded. A page's id is derived
  from its browser and tab, so it stays the same and the agent's earlier references hold.
* Chat links still open in DSH's own Browser tab; dsh-chrome does not take over the
  `browser` tab kind.
* All tools are always declared to the model. Revealing them only when needed (a skill, or
  deferred loading) would shorten every prompt.
