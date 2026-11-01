---
'@langify-org/dsh-code-server': patch
---

Keep the editor connected when its window reloads, for example after you trust its folder. The reloaded window's extension used to be refused with `binding_unavailable`, and file links stopped reaching the editor until **Reconnect**. A binding now waits up to a minute for its window to attach again, and a reloaded window replaces the one it was, even when code-server keeps the old extension host running.
