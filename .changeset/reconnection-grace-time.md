---
'@langify-org/dsh-code-server': patch
---

Start code-server with `--reconnection-grace-time 600`. A window that disappears without closing — a phone browser put to sleep, a dropped network — now gives up its extension host after 10 minutes instead of code-server's default of 3 hours. Each extension host can hold several hundred megabytes with its language servers.
