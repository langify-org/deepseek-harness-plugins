# @langify-org/dsh-dev

Runs a development DeepSeek Harness (DSH) with this workspace's plugins installed. It
keeps the development DSH in a home of its own, `.dsh-home` at the repository root, so the
DSH you use every day, and its sessions, profiles and keys, are left alone.

```console
pnpm dev                      # build and install the plugins, then serve DSH's web UI
pnpm dev --port 3390 --no-open
pnpm dsh plugin --profile web list
```

| Command | What it does |
| --- | --- |
| `dsh-dev start [web options]` (`pnpm dev`) | Builds and installs the plugins, then runs `dsh web` with the options given. Stop it with Ctrl+C. |
| `dsh-dev install` | Builds and installs the plugins without starting DSH. |
| `dsh-dev dsh <arguments>` (`pnpm dsh`) | Runs the development DSH's own `dsh` command, for example `dsh web --help`. |

DSH's default workspace is the directory `pnpm dev` runs from.

## How it works

1. **Finds a DSH installation.** It uses the one whose resources directory `DSH_RUNTIME`
   names, else the DSH Desktop it runs under (in Desktop's terminal), else the newest DSH
   Desktop unpacked in the Nix store. It runs DSH with the Node.js and pnpm that DSH
   ships: DSH reaches Node's internals through a native addon that works only with the
   official Node.js build, and its plugin commands run `pnpm` from PATH.
2. **Prepares the home.** `.dsh-home/bin/pnpm` runs DSH's pnpm, and goes first on DSH's
   PATH. DSH gets the home as `DSH_HOME`, and none of the `DSH_*` variables of a
   surrounding DSH, nor those pnpm sets for its scripts.
3. **Builds and packs each plugin.** Every package under `plugins/` with a `dsh` field is
   built and packed into `.dsh-home/packages/`, named by its content.
4. **Installs the packs** into the home's `web` profile with `dsh plugin add`, as DSH
   installs any plugin: only the packs that changed, and it removes plugins that left the
   workspace. Plugins installed into the profile by hand are left alone.
5. **Starts `dsh web`** in the foreground.

The home holds what any DSH home holds: profiles, sessions, and the keys entered on the
Models page. Delete `.dsh-home` to start afresh.

## Requirements

Linux or macOS, Node.js 24, the workspace installed (`pnpm install`), and DSH: DSH Desktop
installed, or `DSH_RUNTIME` naming a DSH Desktop's resources directory (the one holding
`app/dsh/node_modules/@deepseek-ai/dsh`).
