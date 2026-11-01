---
'@langify-org/dsh-code-server': minor
---

Serve the editor fully in DSH Desktop. Desktop shows DSH at `dsh-app://app`, where code-server's themes, icons, and webviews could not load. In Desktop the plugin now serves the editor on its own port on `127.0.0.1` (new `desktopPort` setting, default `41820`), behind a random token that only DSH's authenticated pages receive. The editor there no longer shares DSH's origin. Browsers keep loading it through DSH as before.
