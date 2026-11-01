# @langify-org/dsh-code-server

English | [日本語](README.ja.md) | [中文](README.zh.md)

Edit a DeepSeek Harness session's working folder in [code-server](https://github.com/coder/code-server), inside DSH's right sidebar. Text-file links in DSH open in that editor, at their line.

## Requirements

- DSH `>=0.2.1-rc.3 <0.3.0-0`, on Linux or macOS.
- code-server, installed separately. Tested with 4.143. The plugin starts and stops it; you do not run it yourself.
- The session's files must be on the machine DSH runs on. Sessions on another file system, such as a sandbox, are refused.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-code-server
```

In DSH Web or Desktop, use the **Plugins** page instead.

## Use

Open the right sidebar, add a tab, and choose **Code**. The page opens the session's working folder; the first time, starting code-server takes a few seconds. Choosing a text file elsewhere in DSH, for example in **Workspace files** or a link in the conversation, shows it in the Code page. Images, PDFs and other files keep DSH's own viewers.

- While the editor is connected, it is where you hear about it. Its status bar shows **DSH** with the connection's state; click it to **Reconnect** or to see the connection log. A file that cannot be opened is reported there, and when the session's working folder changes, a notification offers to reopen the editor on it.
- Reconnecting from the editor asks you to save unsaved changes first, then reloads the editor. Files you chose before reconnecting are not reopened.
- The page speaks only when the editor cannot: while code-server starts or if it fails, and after the connection ends. The editor then stays, with **Reconnect** above it; DSH's refresh command for the tab does the same.
- A file request that the editor did not confirm in time is reported as unknown and never sent again, because the editor may still show it later.

## Configuration

| Setting         | Default       | Meaning                                                             |
| --------------- | ------------- | ------------------------------------------------------------------- |
| `command`       | `code-server` | Executable name or path.                                            |
| `userDataDir`   | empty         | code-server's `--user-data-dir`. Empty uses code-server's default.  |
| `extensionsDir` | empty         | code-server's `--extensions-dir`. Empty uses code-server's default. |

With the defaults, the editor shares settings and extensions with your own code-server. Do not run another code-server on the same directories at the same time.

## How it works

- The plugin starts one code-server for DSH on demand, listening on a Unix socket that only you can open (mode `0600` in a `0700` directory), with code-server's own authentication off. It never opens a network port.
- DSH serves code-server under `/code-server` on its own origin. Every request and WebSocket passes DSH's authentication and origin check first, so code-server is reachable wherever DSH is, for example over Tailscale, and nowhere else.
- In DSH Desktop the page lives at `dsh-app://app`, and code-server would dial its WebSockets at that host. The relay adds a small script to code-server's page that sends them to the address Desktop gives its Host (`__DSH_TRANSPORT__.streamBaseUrl`), where Desktop adds DSH's credentials. In a browser the script changes nothing.
- Before each start, the plugin installs its bundled VS Code extension, **DSH Code Bridge** (`langify-org.dsh-code-bridge`), into code-server, replacing any older copy.
- Each Code page gets its own connection ("binding"). The page puts the binding in the editor's URL fragment, which never reaches a server; the extension in that editor window reads it back and connects to the plugin over another private socket. Files open in that window only, even when several pages show the same folder.

## Security

code-server runs as you, and so do its terminal and extensions, outside DSH's sandbox and approvals. Because it shares DSH's origin, code running in code-server, including extensions and their webviews, can also use DSH with your session. Install only extensions you trust. See also [SECURITY.md](../../SECURITY.md).

## Manual checks

These need a browser and a real code-server, so they are not part of `pnpm check`. Run them with `pnpm dev` before a release. Under `pnpm dev`, [dev.patch.yml](dev.patch.yml) keeps code-server's settings and extensions in `.dsh/code-server/`, apart from your own code-server. Changes to the host and the page reload while `pnpm dev` runs; a change under `src/extension/` takes effect only after restarting `pnpm dev`, because code-server installs the extension when it starts.

1. **Code** shows the editor with nothing above it, and the editor's status bar shows **DSH** as connected, also in Restricted Mode. After the connection ends, the editor stays and a line above it offers **Reconnect**.
2. A text file chosen in **Workspace files** opens in the Code page at its line; an image keeps DSH's viewer.
3. Without signing in, `/code-server/` and `POST /api/langify-code-server/create` answer 401, and a WebSocket upgrade from another origin answers 403.
4. After the session's working folder changes, the editor offers to reopen; with an unsaved file it asks to save first, then the page reloads the editor on the new folder.
5. Closing the Code tab closes its binding; stopping DSH stops code-server and removes its sockets.

## Known limitations

- DSH has no hook before a file tab opens, so a file tab appears briefly before the Code page takes over.
- Finding the binding relies on code-server keeping the page's URL fragment when it answers `vscode.env.asExternalUri`. That is code-server's behavior, not a documented promise; check it again after updating code-server.
