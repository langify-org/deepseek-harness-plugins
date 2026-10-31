# @langify-org/dsh-code-server

## 0.1.1

### Patch Changes

- fd70f2f: Start code-server with `--disable-proxy`. Its `/proxy/<port>` routes would otherwise serve any local web server from DSH's origin, where that content could act on DSH with your session.
