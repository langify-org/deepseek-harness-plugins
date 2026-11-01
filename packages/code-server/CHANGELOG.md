# @langify-org/dsh-code-server

## 0.1.2

### Patch Changes

- 84e7e5d: Connect the editor in DSH Desktop. Desktop shows DSH at `dsh-app://app`, so code-server dialed its server at `ws://app` and reported "The workbench failed to connect to the server". The relay now adds a script to code-server's page that sends those WebSockets to Desktop's Host.

## 0.1.1

### Patch Changes

- fd70f2f: Start code-server with `--disable-proxy`. Its `/proxy/<port>` routes would otherwise serve any local web server from DSH's origin, where that content could act on DSH with your session.
