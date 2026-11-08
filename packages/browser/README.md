# @langify-org/dsh-browser

English | [日本語](README.ja.md) | [中文](README.zh.md)

A real Chromium on the DeepSeek Harness host that you and the model share. **Browser** tabs in the right sidebar show its windows live: you browse in them as in any browser, and the model works in the same windows with `browser_*` tools. The browser runs on the host, so the model can keep using it while no DSH page is open, and every conversation shares its logins.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0-0`, used in a web browser (DSH Web).
- On the DSH host, Linux or another X11 system with:
  - `Xvnc` from [TigerVNC](https://tigervnc.org), on `PATH` or named by the `xvnc` setting.
  - Chromium or Google Chrome, on `PATH` as `chromium` or named by the `chromium` setting.
  - Fonts for the pages you visit, such as Noto Sans CJK for Japanese and Noto Color Emoji for emoji. Missing characters show as boxes.

Without Xvnc or Chromium, the tab says which is missing.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-browser
```

In DSH Web you can also add it from the **Plugins** page.

## Settings

| Setting       | Default                        | What it is                                                                                                                        |
| ------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `xvnc`        | `Xvnc`                         | The Xvnc executable: a name on `PATH`, or a path                                                                                  |
| `chromium`    | `chromium`                     | The Chromium executable: a name on `PATH`, or a path                                                                              |
| `flags`       | `--disable-gpu`                | Command-line flags added after the plugin's own                                                                                   |
| `language`    | empty                          | The language of Chromium's menus and of the pages it asks for (`LANGUAGE`, `--accept-lang`), such as `ja`; empty keeps the host's |
| `stateDir`    | `<DSH home>/browser` (bundled) | Where the profile, downloads and uploads are kept                                                                                 |
| `idleMinutes` | `30`                           | Stop the browser after this many minutes with no Browser tab on view and no use; `0` keeps it running                             |

## Usage

Open **Browser** from the right sidebar. Each Browser tab is one Chromium window, with Chromium's own tabs, address bar and menus. Open as many as you like, in any conversation.

- **One screen**: all windows share one screen, which shows the window of the Browser tab shown last. Another Browser tab on view says so and offers **Show this one**. Switching to a conversation or a tab shows its window.
- **Size**: the window takes the tab's size and follows it when you resize the sidebar. A Chromium window is at least 500 pixels wide; a narrower tab scrolls sideways.
- **Typing in Japanese, Chinese and other languages** uses your device's input method: compose as usual, and the text you commit is typed into the focused field of the page. Other keys, shortcuts included, go to Chromium as keys.
- **Clipboard**: Ctrl+V (Cmd+V) pastes your device's clipboard. What you copy in Chromium reaches your device's clipboard; if the browser refuses the write, the tab offers a **Copy** button.
- **Downloads**: a finished download shows a notice in its window's tab, with **Save** to save it on your device. The host keeps it until the browser next starts.
- **Uploads**: when a page asks for a file, its window's tab offers **Choose…** to pick files on your device, and the page gets them.
- **Logins** live in one Chromium profile that every conversation shares: sign in once, in any tab.
- **Closing** a Browser tab closes its window, and archiving a conversation closes its windows. Closing the last Chromium tab of a window gives its Browser tab a new, blank window.
- **Stopping**: the browser starts when a tab or the model first needs it, and stops after `idleMinutes` with no Browser tab on view and no use. Windows end with it; logins stay.

What the model gets:

- **Its system prompt** describes the shared browser and the tools.
- **Tools** that act on the conversation's window used last, or on the window a call names by its id:

| Tool                 | What it does                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `browser_windows`    | Lists the conversation's windows and their tabs: which one the tools use by default, which one is on your screen     |
| `browser_open`       | Opens an address; in a new window when the conversation has none or when asked, shown by the next Browser tab opened |
| `browser_screenshot` | An image of the page for the model to look at; it needs a model that takes images                                    |
| `browser_click`      | Clicks the element a CSS selector finds, or a point                                                                  |
| `browser_type`       | Types text into the focused field, in any language                                                                   |
| `browser_key`        | Presses a key with modifiers, such as Enter or Control+A                                                             |
| `browser_eval`       | Evaluates JavaScript in the page and returns its JSON value                                                          |

Downloads are also kept under `<stateDir>/downloads/<id>/`, where the model can read them.

## Safety

- **The browser runs outside the sandbox**, so the tools that change pages (`browser_open`, `browser_click`, `browser_type`, `browser_key`, `browser_eval`) ask for the same permission as a command outside it: they run at once when the conversation has full access, and otherwise ask you first. Listing windows and taking screenshots do not ask. Subagents, which cannot ask, can change pages only under full access.
- **Your logins are the model's too**: it works in the same profile, signed in wherever you are. Sign in only where you are fine with the model acting as you.
- **Everything on a page is visible to the model** when it reads the page.
- **The tabs' connections** are checked as DSH's own API requests are: only a signed-in browser of this DSH sees the screen or sends input. VNC listens on a unix socket in a directory only your user can open, and on no network port.
- **Chromium's DevTools port** listens on `127.0.0.1`, at a port Chromium picks, as remote debugging requires: other programs on the host, including other users', can connect to it and control the browser. Use the plugin on a host only you use.
- **Environment**: Xvnc and Chromium get DSH's environment without variables whose names contain `KEY`, `PASSWORD`, `SECRET` or `TOKEN`, and without `DSH_*`, as DSH's own subprocesses do.

## How it works

The host plugin runs `Xvnc` (TigerVNC), a virtual X server that serves its screen over VNC on a unix socket, and Chromium on that screen with the profile in `stateDir`, `--no-startup-window` and a DevTools port of Chromium's choosing. Over the Chrome DevTools Protocol it makes one window per Browser tab, raises the window of the tab shown last and sizes it to the tab, types committed text with `Input.insertText`, saves downloads, and takes the pages' file choosers (`Page.setInterceptFileChooserDialog`). The model's tools use the same connection.

The browser half adds the **Browser** tab. It draws the screen with [noVNC](https://github.com/novnc/noVNC), bundled at a fixed version, over a WebSocket of its own (`/langify-browser/vnc`) that the host relays to Xvnc; noVNC resizes Xvnc's screen to the tab. A second WebSocket (`/langify-browser/control`) carries the tab's requests (show, resize, committed text) and the host's notices (on the screen or not, downloads, file choosers). The keyboard goes through a text box over the screen, so the device's input method works: keys go over VNC through noVNC's translation, and committed text goes over the control channel. Downloads, uploads and closing a window use exact routes on DSH's API channel. DSH loads a browser plugin as CommonJS, which cannot hold noVNC's one top-level `await` (a probe for H.264 decoding), so the build turns it into a promise; the build fails if noVNC changes that line.

## Known limitations

- **One screen**: two Browser tabs, or two devices, cannot show different windows at the same time.
- **Windows that pages open as popups** (`window.open` with a size, such as sign-in popups) appear on top of the screen in whichever tab is shown, without a frame to move them by. They close when the page closes them, or with Ctrl+W.
- **Committed input-method text goes to the page only**, not to Chromium's address bar, menus or prompts: type there in Latin letters, or paste.
- **No sound**: VNC carries no audio.
- **Pages render on the CPU** (`--disable-gpu`): busy pages and video cost CPU on the host and bandwidth to your device.
- **DSH Desktop** is not supported: the tab needs DSH in a web browser.

## Verifying in a browser

`pnpm dev` from the repository root, with Xvnc and Chromium on `PATH`:

1. Open **Browser** from the right sidebar in a conversation. After **Starting the browser…**, Chromium's window shows, with its tab strip and address bar.
2. Type an address into the address bar and press Enter: the page opens.
3. Click a text field in the page and type Japanese with your input method: the composition shows at the field, and the committed text appears in it.
4. Copy text on your device and press Ctrl+V in the field: it is pasted. Select text in the page and press Ctrl+C: it is in your device's clipboard.
5. Download a file from a page: the tab shows a notice, and **Save** saves the file on your device. Click a file input: the tab offers **Choose…**, and the files you pick reach the page.
6. Split the sidebar and open **Browser** in the new pane: it takes the screen, and the first tab offers **Show this one**, which takes it back.
7. Ask the model to open a page and say what it shows. It asks to open the address unless the conversation has full access, takes a screenshot and describes the page, which shows in the tab on view.
8. In the window, close its last Chromium tab with Ctrl+W: the Browser tab gets a new, blank window.
9. Archive the conversation: its windows close. With no Browser tab on view, the browser stops after `idleMinutes`.
