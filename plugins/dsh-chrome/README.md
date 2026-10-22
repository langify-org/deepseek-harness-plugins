# dsh-chrome

Share a real Chrome between you and the agent, in the right sidebar of DeepSeek Harness
(DSH).

dsh-chrome runs a Chrome of its own, on a profile of its own, on a screen of its own on the
machine DSH runs on. The sidebar shows that screen, the whole Chrome window with its tabs,
address bar, menus and extension popups, and sends your pointer, keys and text to it. The
agent reads and operates the same Chrome's pages with tools. The profile keeps what you set
up in it: the sites you signed in to, Chrome's sync, extensions such as 1Password. It works
the same from DSH Desktop and from DSH opened in a browser elsewhere, such as a phone on
your tailnet.

See [docs/design.md](docs/design.md) for how it works and why.

## Requirements

- DSH 0.2 (`>=0.2.1-rc.2 <0.3`), with its web client.
- Linux, with these on the machine DSH runs on:
  - Google Chrome. Tested with Chrome 154.
  - TigerVNC's `Xvnc`, the X server Chrome draws on, which keeps the screen in memory and
    serves it over VNC (`tigervnc` in Nix, `tigervnc-standalone-server` on Debian and Ubuntu).
  - Openbox, the window manager that keeps Chrome's window filling that screen.
- macOS and Windows are not supported: the screen is an X server.

## Install

1. Build the plugin: `nix build .#dsh-chrome` in this repository leaves
   `result/langify-org-dsh-chrome-<version>.tgz`. Copy the tarball somewhere stable.
2. In DSH, open **Plugins → Add plugin** and give the tarball's absolute path. Restart DSH
   completely (on Desktop: quit, not just close the window).

That is all: Chrome starts when you open the Chrome tab, or when the agent first opens a
page. To try the plugin from this repository instead, run `pnpm dev` at its root, which
serves a development DSH with the plugin installed.

dsh-chrome keeps its files in the DSH home, with the rest of DSH's data: `~/.dsh` for
`dsh`, DSH Desktop's own home for Desktop, or wherever `DSH_HOME` points. The profile is
`dsh-chrome/chrome-profile` there. Each home has its own Chrome and screen, so DSH
installations with different homes can run at once.

### From 0.2 or 0.1

0.3 shows the whole Chrome window instead of a page, and runs only its own Chrome:

- The profile 0.2 ran (`dsh-chrome/profiles/dedicated`) moves to `dsh-chrome/chrome-profile`,
  with its sign-ins and extensions. The connector extension and its relay are removed from
  the DSH home, and so are the relay's registrations in the profile and in your own Chrome
  (`NativeMessagingHosts/io.github.langify_org.dsh_chrome.json`) where they name this DSH
  home's relay. Chrome then drops the connector from the profile by itself.
- Your own Chrome is no longer shared. If you loaded the connector there in 0.1, remove it
  in `chrome://extensions`.
- The settings of 0.2 (`dedicatedProfile`, `dailyProfile`, `defaultProfile`, `viewer`,
  `connectorSocketPath`, `nodeExecutable`) are ignored; see [Configure](#configure).

## Set it up

Open **Chrome** from the sidebar's new-tab guide, and set it up there as you would a new
Chrome:

- sign in to the sites the agent should use; they stay signed in;
- sign in to Chrome itself, if you like, so that sync brings your bookmarks, saved
  passwords and extensions;
- add 1Password from the Chrome Web Store and sign in to it. dsh-chrome lets the profile's
  extensions reach the native apps your own Chrome's reach, so 1Password's extension finds
  the desktop app running on that machine as it does in your own Chrome
  (`shareNativeHosts`).

## Use

| In the sidebar | |
| --- | --- |
| Click, drag, scroll, type | Goes to Chrome, as at its own screen. Japanese and other input methods compose in DSH, and the finished text goes to Chrome. |
| Keyboard shortcuts | Go to Chrome by the key's letter, or on a layout without Latin letters by the US key's, so Ctrl+C copies on a Russian keyboard too. On macOS, ⌘ acts as Ctrl. Characters AltGr or Option choose are typed as such. The browser that shows DSH keeps some shortcuts for itself (in Chrome: Ctrl+T, Ctrl+W, Ctrl+N): use Chrome's own ＋ and ✕ for those. |
| Copy and paste | A copy you make in Chrome (a shortcut, a menu, a page's button) reaches your own clipboard too, where the browser allows it: DSH served over HTTPS or on `localhost`. What the agent copies stays in Chrome. Ctrl+V (⌘V) pastes your own clipboard, or Chrome's when your last copy there could not reach yours. |
| 📷 / 📄 | Add a screenshot of Chrome, or the text of the page you are looking at, to your next message. |
| ⌨ | Shows a touch screen's keyboard. On a touch screen, tap to click and drag two fingers to scroll. |

Chrome's own UI is on the screen like the page: menus, permission prompts, extension popups,
the downloads it saves (into the Downloads folder of the machine DSH runs on), and the
dialogs pages open. A window a page opens, such as a sign-in popup, stays above Chrome's
window until it closes; its title bar has a button to close it.

Every Chrome tab in DSH shows the same Chrome. The screen takes the size of the tab you last
looked at or worked in, at two of its pixels for each of the tab's, so it is sharp on
high-density displays too; another tab shows it scaled to fit until you look at or work in
that one. Opening a Chrome tab starts Chrome. Chrome closes when you close its last tab, and
the Chrome tab then offers **Open Chrome**; it starts again, with the same profile, when you
choose that, when a Chrome tab is opened anew, or when the agent opens a page.

The agent gets these tools: `chrome_pages`, `chrome_open`, `chrome_navigate`,
`chrome_snapshot`, `chrome_screenshot`, `chrome_click`, `chrome_type`, `chrome_press`,
`chrome_scroll`, `chrome_answer_dialog`, `chrome_close`, and `chrome_ask_user`. It may use
the pages it opened, the pages those opened, and the pages you opened in Chrome; a page
another session's agent opened is not its own. `chrome_open` opens a new tab in front, and
an action brings its page to the front first, as you would. With `chrome_ask_user`, the
agent asks you to do something yourself, such as signing in or entering a one-time code;
the request appears above Chrome with **Done** and **I can’t**. Its actions report the
dialogs and pages they led to. At the start of each turn, the agent is told which pages it
may use and which one you are looking at, when that changed.

## Configure

Settings go in the DSH profile's `cordis.patch.yml`, under the plugin's row:

```yaml
- id: dsh-chrome
  config:
    deviceScaleFactor: 1
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `executable` | `google-chrome-stable` | The Chrome to run. |
| `xvncExecutable` | `Xvnc` | TigerVNC's Xvnc. |
| `windowManagerExecutable` | `openbox` | Openbox. |
| `deviceScaleFactor` | `2` | How many of the screen's pixels a CSS pixel of Chrome takes, from 1 to 4. 2 is sharp on high-density displays and still clear on others; 1 sends a quarter of the pixels. |
| `announceAutomation` | `false` | Tell pages that Chrome is under automated control (`navigator.webdriver`), as Chrome would for the pipe dsh-chrome controls it through. Google then refuses to sign in, and other sites may take you for a bot; see [Security](#security). |
| `profileDir` | `dsh-chrome/chrome-profile` in the DSH home | The Chrome profile: its user data directory. |
| `shareNativeHosts` | `true` | Let the profile's extensions reach the native apps your own Chrome's reach, by linking their native messaging manifests into it. |
| `userChromeDir` | `~/.config/google-chrome` | Your own Chrome's user data directory, whose native apps are shared. |
| `dataDir` | `dsh-chrome` in the DSH home | Where dsh-chrome keeps what it records between starts. |
| `runtimeDir` | `$XDG_RUNTIME_DIR/dsh-chrome/<digest of the DSH home>`, or in the temporary directory without `XDG_RUNTIME_DIR` | Where the screen's VNC socket and X cookie are. It, and the directory it is in, must be yours: dsh-chrome makes it private, and refuses one of another user. |

The tools and the turn-start reading are separate rows; turn either off on its own:

```yaml
- id: dsh-chrome-tools
  disabled: true
- id: dsh-chrome-context
  disabled: true
```

## Limits

- Chrome asks the desktop of the machine DSH runs on for what it does not draw itself: a
  page's file chooser opens there (through the desktop portal, on GNOME and KDE), not in the
  sidebar, and so do site notifications. Uploading a file from another device is not
  possible yet.
- Text an input method composes reaches Chrome as a paste when it has characters beyond
  ASCII (Japanese, accented letters, emoji), so it also becomes the clipboard of Chrome's
  screen. Keys, ASCII and single characters are typed. A paste larger than 256 KiB, Xvnc's
  limit, does not arrive.
- Windows have no taskbar: keep to tabs, since a second Chrome window covers the first.
- Pages get no WebGL: the screen has no GPU, and Chrome no longer draws WebGL in software
  on its own. 3D maps and WebGL games do not work.
- The screen carries no sound.
- Pages that a subagent opens belong to the subagent's session, not to yours.

## Security

- Whoever can use your DSH's web UI can use this Chrome, with every sign-in in its profile,
  as they can use DSH's terminal.
- No TCP port is opened. dsh-chrome controls Chrome over the pipe it starts Chrome with
  (`--remote-debugging-pipe`), which only it holds. Xvnc serves the screen on a Unix socket
  only (`-rfbport -1`, `-nolisten tcp`), without a password, in a directory only your OS user
  can enter. As an X server, it admits only the programs given its cookie (`Xauthority` in
  that directory): Openbox and Chrome. Other processes of your user are trusted, as they can
  already read the profile.
- The sidebar reaches the screen through DSH's own authenticated WebSocket, admitted like
  DSH's `/api`.
- dsh-chrome sends Chrome only the CDP commands it uses, and the agent's tools read and
  operate web pages only: not Chrome's own pages (settings, saved passwords), extensions'
  pages, or local files, even when you opened them; nor cookie stores, network traffic, or
  other extensions' code on a page (your password manager's).
- Pages are not told that Chrome is under automated control: `navigator.webdriver` is false,
  as in a Chrome you use by hand. Chrome would set it for the pipe it is controlled through,
  and Google's sign-in then refuses the browser ("This browser or app may not be secure"),
  as do other sites' bot checks, even when you are the one at the controls. So sites cannot
  tell either when the agent acts; it acts at a person's pace, in your sessions, on your
  behalf. Set `announceAutomation` to tell them, if sites you use require it. Chrome warns
  of the flag this takes, `--disable-blink-features=AutomationControlled`, with a bar in its
  first tab at each start ("unsupported command-line flag"); the flag changes nothing but
  `navigator.webdriver`, and the bar's ✕ closes it.
- With `shareNativeHosts`, the profile's extensions can start the native apps your own
  Chrome's can. Each app's manifest still names the only extensions it accepts.
- The agent may not open DSH's own web UI through Chrome, nor operate a page that shows it,
  in a frame included: in a profile signed in to DSH, it could otherwise approve its own
  actions. DSH is recognized by the addresses it serves; one behind a proxy on another local
  port is not.
- Pages are web content: snapshots, page text, dialogs and screenshots reach the agent
  marked as untrusted, and titles are quoted and shortened. The agent is told never to type
  passwords, codes or card numbers, and to ask you instead; the plugin cannot enforce what
  a model does with a field.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "Xvnc (Xvnc) was not found" | Install TigerVNC where DSH's environment finds it, or set `xvncExecutable`. |
| "the window manager (openbox) was not found" | Install Openbox, or set `windowManagerExecutable`. |
| "Chrome (google-chrome-stable) was not found" | Install Google Chrome, or set `executable`. |
| Google: "This browser or app may not be secure" | `announceAutomation` is off, as it is by default. |
| Chrome starts and closes at once | Another Chrome may use the profile: dsh-chrome's runs only one. Look for a `chrome` whose `--user-data-dir` is `profileDir`. |
| 1Password's extension cannot reach the app | The desktop app runs on the machine DSH runs on, its browser integration is on for Chrome, and `~/.config/google-chrome/NativeMessagingHosts/com.1password.1password.json` exists. |

## Develop

From the repository root: `pnpm install`, then `pnpm dev` to try the plugin in a
development DSH. In this directory, `pnpm build`, `pnpm test` (unit), `pnpm test:compat`
(against DSH's packages, after a build), and `pnpm test:integration`. The integration tests
start Chrome in temporary profiles on Xvnc under Openbox: the agent's tools, checked by
DSH's own schema validator; Chrome on its screen, as a VNC client sees and works it; and the
whole path from the built sidebar module, with noVNC, in a headless Chrome, through DSH's
web server, to Chrome. Every test process gets a DSH home of its own.

`src/` is split by where the code runs, and within the Host by what each part is; which part
may import which is defined, and checked, in
[test/unit/dependencies.test.ts](test/unit/dependencies.test.ts).

The sidebar bundles [noVNC](https://github.com/novnc/noVNC) 1.7.0 (MPL-2.0), whose license
the package carries in `dist/licenses/`. A patch (`patches/` at the repository root) removes
noVNC's one top-level `await`, which DSH's module loader cannot run.
