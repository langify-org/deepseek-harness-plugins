# dsh-chrome

Share a page of your own Chrome between you and the agent, in the right sidebar of
DeepSeek Harness (DSH).

The page lives in your real Chrome profile, so it has your logins and your extensions,
1Password included. The sidebar shows it and sends your clicks and typing to it; the
agent reads and operates the same page with tools. It works the same from DSH Desktop and
from DSH opened in a browser elsewhere, such as a phone on your tailnet.

See [docs/design.md](docs/design.md) for how it works and why.

## Requirements

- DSH 0.2 (`>=0.2.1-rc.2 <0.3`), with its web client.
- Google Chrome 120 or later, running on the same machine and user as DSH. Tested with
  Chrome 154 on Linux. macOS should work but is untested; Windows is not supported.

## Install

1. Build the plugin: `nix build .#dsh-chrome` in this repository leaves
   `result/langify-org-dsh-chrome-<version>.tgz`. Copy the tarball somewhere stable.
2. In DSH, open **Plugins → Add plugin** and give the tarball's absolute path. Restart DSH
   completely (on Desktop: quit, not just close the window).
3. Install the connector in Chrome. DSH writes it to `~/.local/share/dsh-chrome/extension`
   when the plugin starts. In Chrome, open `chrome://extensions`, turn on **Developer
   mode**, choose **Load unpacked**, and select that directory.

Chrome connects within a few seconds and reconnects whenever DSH or Chrome restarts. After
a plugin update, the connector reloads itself to match.

## Use

Open **Chrome** from the sidebar's new-tab guide and enter an address. The page opens in a
window of your Chrome that dsh-chrome keeps for its pages, in a tab group named after the
DSH session.

| In the sidebar | |
| --- | --- |
| Click, scroll, type | Goes to the page. Japanese and other input methods compose in DSH and send the finished text. On a touch screen, tap to click and drag to scroll. |
| ← → ↻ and the address bar | Navigate the page. |
| Page list | Switch between the session's pages, including those the agent opened. |
| 📷 / 📄 | Add a screenshot or the page's text to your next message. |
| ✕ | Close the page. |

The agent gets these tools: `chrome_pages`, `chrome_open`, `chrome_navigate`,
`chrome_snapshot`, `chrome_screenshot`, `chrome_click`, `chrome_type`, `chrome_press`,
`chrome_scroll`, `chrome_close`, and `chrome_ask_user`. With the last one, the agent asks
you to do something yourself, such as signing in or entering a one-time code; the request
appears above the page with **Done** and **I can’t**. At the start of each turn, the agent
is told which pages the session shares and which one you are looking at, when that changed.

While dsh-chrome controls pages, Chrome shows a bar saying that the connector started
debugging the browser. Cancelling it stops sharing every page.

## Configure

Settings go in the DSH profile's `cordis.patch.yml`, under the plugin's row:

```yaml
- id: dsh-chrome
  config:
    defaultProfile: daily
    viewer:
      jpegQuality: 70
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `dailyProfile.enabled` | `true` | Let your own Chrome profile connect. |
| `dailyProfile.userDataDir` | `~/.config/google-chrome` | Your Chrome's user data directory. |
| `dedicatedProfile.enabled` | `false` | Let dsh-chrome start a separate Chrome profile of its own. |
| `dedicatedProfile.executable` | `google-chrome-stable` | The Chrome it starts. |
| `dedicatedProfile.userDataDir` | `~/.local/share/dsh-chrome/profiles/dedicated` | That profile's directory. |
| `dedicatedProfile.display` | `virtual` | `virtual`: a private Xvfb display that keeps working while the screen is locked. `desktop`: a normal window, for signing in to sites the first time. |
| `defaultProfile` | `daily` | The profile new pages open in: `daily` or `dedicated`. |
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

### A dedicated profile

With `dedicatedProfile.enabled`, the agent can open pages in a Chrome profile that is not
yours (`chrome_open` with `profile: dedicated`, or `defaultProfile: dedicated`). Start it
once with `display: desktop` to sign in to the sites it needs, then switch to `virtual`.
1Password needs its native messaging manifest in the profile:
`ln -s ~/.config/google-chrome/NativeMessagingHosts/com.1password.1password.json
~/.local/share/dsh-chrome/profiles/dedicated/NativeMessagingHosts/`. Google may refuse
sign-in to a browser it believes is automated; sign in there with `display: desktop`.

## What the sidebar cannot show

The sidebar shows the page, not Chrome around it. Chrome's own UI stays in the Chrome
window: permission prompts, extension popups (1Password's toolbar popup; its in-page
autofill menu does show), file pickers, `alert` and `confirm` dialogs, and the lists of
`<select>` menus (use the arrow keys instead).

A page in a minimized or covered Chrome window is captured a few times a second instead
of streamed.

## Security

- No remote-debugging port is opened. The connector controls only the tabs it opened, and
  refuses CDP commands that read cookies.
- Chrome starts the connector's relay only for the connector's extension id. The relay
  reaches DSH over a Unix socket that only your OS user can open; other processes of your
  user are trusted, as they already can read your browser profile.
- The sidebar connects over DSH's own authenticated channel; it opens no new port.
- Pages are web content: what the agent reads from them is marked untrusted. The agent is
  told never to type passwords, codes or card numbers, and to ask you instead; the plugin
  cannot enforce what a model does with a field.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "your Chrome is not connected" | Chrome is running, the connector is loaded in `chrome://extensions` without errors, and `~/.config/google-chrome/NativeMessagingHosts/io.github.langify_org.dsh_chrome.json` exists. DSH's log says when a browser connects. |
| Chrome never connects | Run the relay as Chrome would: `~/.local/share/dsh-chrome/native-host-daily < /dev/null`. It exits quietly when it reached DSH, and prints why when it could not (DSH not running, or a `nodeExecutable` that cannot run outside DSH). |
| The page is blank in the sidebar | The Chrome window may be minimized; the sidebar then shows captures. Reload the page from the toolbar. |

## Develop

From the repository root: `pnpm install`, then in this directory `pnpm build`,
`pnpm test` (unit), `pnpm test:compat` (against DSH's packages, after a build), and
`pnpm test:integration` (a real Chrome in a temporary profile on Xvfb).
