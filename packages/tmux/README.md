# @langify-org/dsh-tmux

English | [日本語](README.ja.md) | [中文](README.zh.md)

A terminal per conversation that you and the model share, on tmux. Each conversation gets its own tmux session, shown in a **tmux** tab in DeepSeek Harness's right sidebar. The session outlives page reloads, closed tabs and DSH restarts. The model learns at the start of a turn which windows exist, and works in them with tools that can run any tmux command.

## Requirements

- DSH `>=0.2.2-rc.2 <0.3.0-0` with the Web UI.
- [`tmux`](https://github.com/tmux/tmux) on the DSH host, on `PATH` or named by the `tmux` setting. Without it, the tab says so. tmux does not run on Windows hosts.
- Optional: user systemd (`systemd-run --user`). With it, the tmux server runs in its own scope and keeps your windows through DSH restarts. Without it, the server stops with DSH.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-tmux
```

In DSH Web and Desktop you can also add it from the **Plugins** page.

## Settings

| Setting  | Default                            | What it is                                       |
| -------- | ---------------------------------- | ------------------------------------------------ |
| `tmux`   | `tmux`                             | The tmux executable: a name on `PATH`, or a path |
| `socket` | `<DSH home>/tmux/socket` (bundled) | The tmux server's socket                         |

## Usage

Open **tmux** from the right sidebar. It shows the conversation's tmux session.

- **Your tmux configuration is used as is**, wherever your tmux looks for it (by default `/etc/tmux.conf`, `~/.tmux.conf` or `~/.config/tmux/tmux.conf`). The plugin only keeps its tmux server running while no session is open.
- **Without a tmux configuration**, the plugin's defaults apply: the status line is at the top with the windows as tabs, and the mouse works, so a click on a window switches to it and the wheel scrolls. With your own configuration, add `set -g mouse on` for the same.
- **Right click** goes to tmux, without the browser's menu over it: hold the button, move to an item of tmux's menu and release. Shift and a right click, or a long press, opens the browser's menu.
- **Copying**: a mouse selection or tmux's copy mode copies to your device's clipboard (tmux sends it as OSC 52). If the browser refuses the write, the tab offers a **Copy** button. Shift and a drag selects with the browser instead, and Ctrl+C (Cmd+C) copies that.
- **Links** that programs mark (OSC 8, such as `ls --hyperlink`) open with Ctrl or Cmd and a click.
- **The look** follows DSH: its light or dark background and text colors, and its terminal font and size.
- **On a phone**, a tap on a window switches to it, and a swipe scrolls back through tmux's history (tmux's copy mode; `q` leaves it).
- **Several tabs**, on one device or several, each show their own window of the same session. Closing a tab or losing the connection leaves the session and its programs running; the tab attaches again when it reconnects.
- **Archiving the conversation** ends its tmux session. If programs are still running, the archive dialog lists them as work to stop.
- **From your own terminal**, `tmux -S <DSH home>/tmux/socket attach -t '=dsh-<session id>'` attaches to the same session. DSH's own terminal tab stays a plain shell.

What the model learns about the terminal:

- **Its system prompt** describes the shared terminal, the tools and the notes below, in every conversation.
- **At the start of a turn**, when the windows changed since it last saw them, it gets a `<tmux>` note with one `<window id="@3" name="bash" path="~/repo" command="bash"/>` per window. An empty `<tmux>` says the session is closed. A conversation without a session gets no note.
- **Screen contents** only when it reads a window itself.

The model has two tools that run any tmux command, with the socket and the target filled in by the plugin:

| Tool           | Arguments                                            | Aimed at                                                                     |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tmux_window`  | window id (required), pane index, command, arguments | that window or pane, after checking it belongs to the conversation's session |
| `tmux_session` | command, arguments                                   | the conversation's session                                                   |

Windows are aimed at by id because ids never change or get reused while the tmux server runs; numbers and names can. For example, `tmux_window` with `capture-pane -p` reads a window and with `send-keys` types into one; `tmux_session` with `new-window -d` opens a window and prints its id, creating the session if there is none. New windows and panes start in the conversation's folder. The model cannot pass its own `-t`, or `-a` to `list-windows` and `list-panes`, so it cannot reach outside the conversation. A subagent's calls go to its conversation's session.

## Safety

- **tmux runs outside the sandbox**, so a tmux command that changes anything asks for the same permission as a command outside it: it runs at once when the conversation has full access, and otherwise asks you first, showing the tmux command. Subagents, which cannot ask, can do so only under full access.
- **Reading needs no permission**: `capture-pane -p`, `list-windows`, `list-panes` and `show-options` run without asking, unless an argument contains `#(` (a format that runs a shell command) or ends in `;` (which starts another tmux command).
- **Everything in the session is visible to the model.** Do not show secrets in a conversation's terminal unless you are fine with the model reading them.
- **The tab's connection** is checked as DSH's own API requests are: only a signed-in browser of this DSH gets a terminal.
- **Environment**: tmux and its shells get DSH's environment without variables whose names contain `KEY`, `PASSWORD`, `SECRET` or `TOKEN`, and without `DSH_*`, as DSH's own terminals do.
- **Isolation**: each DSH home has its own tmux server (`<DSH home>/tmux/socket`), so your own tmux sessions are untouched, and each conversation is told only about its own session. Subagents are not told about it.

## How it works

The browser half adds the **tmux** tab and copies what tmux sends as OSC 52 to the clipboard. It renders the terminal with [wterm](https://github.com/vercel-labs/wterm), bundled at a fixed version, and talks to the host over a WebSocket of its own (`/langify-tmux`). For each connection, the host checks it as DSH's API requests are, creates the conversation's tmux session (`dsh-<session id>`) if needed and runs `tmux new-session -t '=dsh-<session id>'` in DSH's terminal subprocess provider: a view of its own that ends with the connection, so tabs can show different windows.

The host plugin also adds the guide to the system prompt, registers the two tools and starts the server if needed (in its own systemd scope when it can) with `exit-empty off`, and adds the `hyperlinks` terminal feature for the tab's terminal type, so tmux passes links on. It asks the server which configuration files it looks for (`#{config_files}`), and, when none of them exists, sets its defaults on the server. It adds the window list to a turn's first step through `agent/pre-step`; a session projection remembers what the model last saw, and compaction resets it. It provides a `langifyTmux` service for other plugins, such as tasks: it runs a command line in a new window of a conversation's session, and the next tmux tab to attach within 10 seconds shows that window. It also reports running programs to the archive dialog, ends the session on archive, and on start ends sessions of conversations archived or deleted meanwhile.

## Known limitations

- **The server keeps running** after you remove the plugin; stop it with `tmux -S <DSH home>/tmux/socket kill-server`.
- **Faint colors in the light theme**: the 16 terminal colors are xterm's, as in DSH's own terminal, and yellow and white show weakly on a light background.
- **No Ctrl, Esc, Tab or arrow keys on a phone**: a phone's keyboard has none, and the tab adds none.

## Verifying in a browser

`pnpm dev` from the repository root, with tmux on `PATH`:

1. Open **tmux** from the right sidebar in a conversation. It shows the status line with window `0`.
2. Hold the right button in the terminal, move to **Horizontal Split** in tmux's menu and release: the window splits, and the browser's menu does not open.
3. Ask the model to open a window, run `echo hello` in it and read it back. It opens a window with `tmux_session`, asking first unless the conversation has full access, types the command with `tmux_window`, reads it back without asking and reports `hello`.
4. Ask the model what windows there are. It lists both windows with their folders.
5. Drag over some text in the terminal: once you release the button, it is in your clipboard.
6. Reload the page: the tab attaches again, with the same windows.
7. Archive the conversation while `sleep 600` runs in a window: the dialog lists one item of tmux work, and stopping it ends the tmux session.
