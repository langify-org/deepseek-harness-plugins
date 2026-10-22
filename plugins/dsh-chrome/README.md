# dsh-chrome

Share a Chrome page between you and the agent, in the right sidebar of DeepSeek Harness
(DSH).

The page lives in a real Chrome, which dsh-chrome runs out of sight on a profile of its
own: nothing appears on your screen, and the sidebar shows the page and sends your clicks
and typing to it. The agent reads and operates the same page with tools. The profile keeps
what you set up in it: the sites you signed in to, Chrome's sync, extensions such as
1Password. It works the same from DSH Desktop and from DSH opened in a browser elsewhere,
such as a phone on your tailnet.

Your own Chrome profile can be connected instead, with the logins you already have; its
pages then open in a window on your screen (see [Your own Chrome](#your-own-chrome)).

See [docs/design.md](docs/design.md) for how it works and why.

## Requirements

- DSH 0.2 (`>=0.2.1-rc.2 <0.3`), with its web client.
- Google Chrome 120 or later, on the machine DSH runs on. Tested with Chrome 154 on Linux.
- Xvfb, the virtual display the hidden Chrome runs on (Linux). Without it, set
  `dedicatedProfile.display: desktop`, which shows its windows instead.
- macOS should work with `display: desktop` but is untested; Windows is not supported.

## Install

1. Build the plugin: `nix build .#dsh-chrome` in this repository leaves
   `result/langify-org-dsh-chrome-<version>.tgz`. Copy the tarball somewhere stable.
2. In DSH, open **Plugins → Add plugin** and give the tarball's absolute path. Restart DSH
   completely (on Desktop: quit, not just close the window).

That is all: the Chrome starts when a page first opens. To try the plugin from this
repository instead, run `pnpm dev` at its root, which serves a development DSH with the
plugin installed.

dsh-chrome keeps its files in the DSH home, with the rest of DSH's data: `~/.dsh` for
`dsh`, DSH Desktop's own home for Desktop, or wherever `DSH_HOME` points. The profile is
`dsh-chrome/profiles/dedicated` there. Each home has its own, so DSH installations with
different homes can run at once.

## Set it up

The Chrome starts with an empty profile. Press **⚙** in the Chrome tab's toolbar to show
its window on the screen of the computer DSH runs on, and set it up there as you would a
new Chrome:

- sign in to the sites the agent should use; they stay signed in;
- sign in to Chrome itself, if you like, so that sync brings your bookmarks, saved
  passwords and extensions;
- add 1Password from the Chrome Web Store and sign in to it. dsh-chrome lets the profile's
  extensions reach the native apps your own Chrome's reach, so 1Password's extension finds
  the desktop app as it does in your own Chrome (`dedicatedProfile.shareNativeHosts`).

Press **Done** above the page, or quit that Chrome, and it goes back out of sight.
Chrome cannot move its windows between displays, so it starts again each way, and the
pages it showed close.

## Use

Open **Chrome** from the sidebar's new-tab guide and enter an address.

| In the sidebar | |
| --- | --- |
| Click, scroll, type | Goes to the page. Japanese and other input methods compose in DSH and send the finished text. On a touch screen, tap to click and drag to scroll. |
| ← → ↻ and the address bar | Navigate the page. |
| Page list | Switch between the session's pages, including those the agent opened. |
| 📷 / 📄 | Add a screenshot or the page's text to your next message. |
| ✕ | Close the page. |
| ⚙ | Show the Chrome on the computer's screen, to set it up. |

Pages a page opens, such as a sign-in popup or a link that opens a new tab, join the
session. The sidebar follows a page brought to the front, as a Chrome window would, and
returns to the page that opened it when it closes. A dialog the page opens (`alert`,
`confirm`, `prompt`, or whether to leave the page) appears above the page; the page waits
until you answer it there.

The agent gets these tools: `chrome_pages`, `chrome_open`, `chrome_navigate`,
`chrome_snapshot`, `chrome_screenshot`, `chrome_click`, `chrome_type`, `chrome_press`,
`chrome_scroll`, `chrome_answer_dialog`, `chrome_close`, and `chrome_ask_user`. With the
last one, the agent asks you to do something yourself, such as signing in or entering a
one-time code; the request appears above the page with **Done** and **I can’t**. Its
actions report the dialogs and pages they led to. At the start of each turn, the agent is
told which pages the session shares and which one you are looking at, when that changed.

## Your own Chrome

To share pages of the Chrome you use every day, with its logins and extensions:

```yaml
- id: dsh-chrome
  config:
    dailyProfile:
      enabled: true
    defaultProfile: daily
```

Then install the connector there: when the plugin starts, it writes it to
`dsh-chrome/extension` in the DSH home. In Chrome, open `chrome://extensions`, turn on
**Developer mode**, choose **Load unpacked**, and select that directory. Until Chrome is
connected, opening a page says so and names the directory. On every start, the plugin
registers the connector's relay with Chrome by writing
`NativeMessagingHosts/io.github.langify_org.dsh_chrome.json` into Chrome's user data
directory (`~/.config/google-chrome` by default); Chrome starts that relay only for the
connector, and nothing else in the profile changes. Turned off again, the plugin removes
that file if it is still its own. A Chrome user data directory names one relay, so it
connects to the DSH that wrote its file last.

Its pages open in a window of your Chrome, on your screen, in a tab group named after the
DSH session, and your Chrome differs from the hidden one in what dsh-chrome may do:

- Chrome shows a bar saying that the connector started debugging the browser; cancelling
  it stops sharing every page. As the bar comes and goes, and when the window is resized,
  Chrome lays the window out again, and the sidebar may flicker for a moment.
- dsh-chrome never brings the window to the front, which would take your focus. Chrome
  shows a page's `confirm` and `prompt` only while the page is in front, and answers them
  for a page that is not as if you had cancelled.
- A page in a minimized or covered window is captured a few times a second instead of
  streamed.

## Configure

Settings go in the DSH profile's `cordis.patch.yml`, under the plugin's row:

```yaml
- id: dsh-chrome
  config:
    viewer:
      jpegQuality: 70
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `dedicatedProfile.enabled` | `true` | Run a Chrome of its own for dsh-chrome, started when a page opens. |
| `dedicatedProfile.executable` | `google-chrome-stable` | The Chrome it starts. |
| `dedicatedProfile.userDataDir` | `dsh-chrome/profiles/dedicated` in the DSH home | Its profile's directory. |
| `dedicatedProfile.display` | `virtual` | `virtual`: a private Xvfb display, which also works while the screen is locked. `desktop`: its windows on your screen. **⚙** shows them for a while either way. |
| `dedicatedProfile.shareNativeHosts` | `true` | Let its extensions reach the native apps your own Chrome's reach, by linking their native messaging manifests into its profile. |
| `dailyProfile.enabled` | `false` | Let the connector in your own Chrome profile reach this DSH. |
| `dailyProfile.userDataDir` | `~/.config/google-chrome` | Your Chrome's user data directory, and where the native apps are linked from. |
| `defaultProfile` | `dedicated` | The profile new pages open in: `dedicated` or `daily`. |
| `dataDir` | `dsh-chrome` in the DSH home | Where the connector and its relay are kept for Chrome. |
| `connectorSocketPath` | one per DSH home, in `$XDG_RUNTIME_DIR/dsh-chrome` | The Unix socket the relay connects to. |
| `nodeExecutable` | the Node running DSH | The Node that Chrome runs the connector's relay with. Set it if that Node cannot run outside DSH. |
| `viewer.jpegQuality` | `70` | JPEG quality of the frames the sidebar shows. |
| `viewer.hiddenFrameIntervalMs` | `250` | How often a page hidden in Chrome is captured while you view it. |
| `viewer.maxDeviceScaleFactor` | `2` | The highest pixel density a page renders at. |

The tools and the turn-start reading are separate rows; turn either off on its own:

```yaml
- id: dsh-chrome-tools
  disabled: true
- id: dsh-chrome-context
  disabled: true
```

## What the sidebar cannot show

The sidebar shows the page, not Chrome around it. Chrome's own UI stays in Chrome's
window, where only **⚙** shows it: permission prompts, extension popups (1Password's
toolbar popup; its in-page autofill menu does show), file pickers, and the lists of
`<select>` menus (use the arrow keys instead). So a page cannot be given a file, and a
download goes to Chrome's download folder without a word. Google may refuse to sign in a
browser it believes is automated; sign in with **⚙** instead.

Pages that a subagent opens belong to the subagent's session, not to yours.

## Security

- No remote-debugging port is opened. The connector controls only the tabs it opened and
  the tabs those opened, and passes on only the CDP commands, parameters and events
  dsh-chrome uses. Through it, the plugin reaches no further than the page's own scripts:
  cookie stores, network traffic (which carries cookies and credentials), other
  extensions' code on the page (your password manager's), and local files stay out of its
  reach.
- Chrome starts the connector's relay only for the connector's extension id. The relay
  reaches DSH over a Unix socket that only your OS user can open; other processes of your
  user are trusted, as they already can read your browser profile.
- The hidden Chrome shows no debugging bar (`--silent-debugger-extension-api`): its profile
  is dsh-chrome's own, and nobody would see the bar.
- With `shareNativeHosts`, the hidden Chrome's extensions can start the native apps your
  own Chrome's can. Each app's manifest still names the only extensions it accepts.
- The sidebar connects over DSH's own authenticated channel; it opens no new port.
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
| "could not start Xvfb" | Install Xvfb, or set `dedicatedProfile.display: desktop`. |
| "could not start the dedicated Chrome" | `google-chrome-stable` runs from DSH's environment, or set `dedicatedProfile.executable`. |
| "your Chrome is not connected" | (Your own Chrome) Chrome is running, the connector is loaded in `chrome://extensions` without errors, and `~/.config/google-chrome/NativeMessagingHosts/io.github.langify_org.dsh_chrome.json` exists. |
| Your Chrome never connects | Run the relay as Chrome would: `<DSH home>/dsh-chrome/native-host-daily < /dev/null`. It exits quietly when it reached DSH, and prints why when it could not (DSH not running, or a `nodeExecutable` that cannot run outside DSH). |
| The page is blank in the sidebar | (Your own Chrome) The window may be minimized; the sidebar then shows captures. Reload the page from the toolbar. |

## Develop

From the repository root: `pnpm install`, then `pnpm dev` to try the plugin in a
development DSH. In this directory, `pnpm build`, `pnpm test` (unit), `pnpm test:compat`
(against DSH's packages, after a build), and `pnpm test:integration`. The integration
tests start Chrome in temporary profiles on Xvfb: the connector, page actions, popups,
dialogs and steady frames, with windows arranged as for your own Chrome and as for the
hidden one; the agent's tools, checked by DSH's own schema validator; and the whole path
from the built sidebar module in a headless Chrome, through DSH's web server, to the
shared page. Every test process gets a DSH home of its own.

`src/` is split by process, and within the Host by what each part is; which part may
import which is defined, and checked, in [test/unit/dependencies.test.ts](test/unit/dependencies.test.ts).
