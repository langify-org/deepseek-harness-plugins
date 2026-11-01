# @langify-org/dsh-code-server

## 0.2.2

### Patch Changes

- a5b55b9: Before opening an editor window, install the bundled extension again if its VSIX changed since code-server started. This only happens for a linked development copy, where a rebuilt extension now reaches the next window without restarting DSH. The log line of a window that lost its connection no longer tells you to reopen the Code tab; a reloaded window reattaches by itself.

## 0.2.1

### Patch Changes

- ac5065d: Keep the editor connected when its window reloads, for example after you trust its folder. The reloaded window's extension used to be refused with `binding_unavailable`, and file links stopped reaching the editor until **Reconnect**. A binding now waits up to a minute for its window to attach again, and a reloaded window replaces the one it was, even when code-server keeps the old extension host running.

## 0.2.0

### Minor Changes

- 997144f: Serve the editor fully in DSH Desktop. Desktop shows DSH at `dsh-app://app`, where code-server's themes, icons, and webviews could not load. In Desktop the plugin now serves the editor on its own port on `127.0.0.1` (new `desktopPort` setting, default `41820`), behind a random token that only DSH's authenticated pages receive. The editor there no longer shares DSH's origin. Browsers keep loading it through DSH as before.

## 0.1.2

### Patch Changes

- 84e7e5d: Connect the editor in DSH Desktop. Desktop shows DSH at `dsh-app://app`, so code-server dialed its server at `ws://app` and reported "The workbench failed to connect to the server". The relay now adds a script to code-server's page that sends those WebSockets to Desktop's Host.

## 0.1.1

### Patch Changes

- fd70f2f: Start code-server with `--disable-proxy`. Its `/proxy/<port>` routes would otherwise serve any local web server from DSH's origin, where that content could act on DSH with your session.
