---
'@langify-org/dsh-code-server': patch
---

Start code-server with `--disable-proxy`. Its `/proxy/<port>` routes would otherwise serve any local web server from DSH's origin, where that content could act on DSH with your session.
