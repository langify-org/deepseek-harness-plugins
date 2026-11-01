---
'@langify-org/dsh-code-server': patch
---

Before opening an editor window, install the bundled extension again if its VSIX changed since code-server started. This only happens for a linked development copy, where a rebuilt extension now reaches the next window without restarting DSH. The log line of a window that lost its connection no longer tells you to reopen the Code tab; a reloaded window reattaches by itself.
