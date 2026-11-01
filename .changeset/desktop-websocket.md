---
'@langify-org/dsh-code-server': patch
---

Connect the editor in DSH Desktop. Desktop shows DSH at `dsh-app://app`, so code-server dialed its server at `ws://app` and reported "The workbench failed to connect to the server". The relay now adds a script to code-server's page that sends those WebSockets to Desktop's Host.
