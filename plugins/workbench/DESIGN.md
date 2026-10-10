# @langify-org/dsh-workbench — design

Status: design. Nothing is implemented yet. This file stays in the repository and is not published.

## Goal

Make a named place where a person and an agent work, before any conversation starts, and remove it when the work is done.

A **workbench** is a directory derived from a parent DSH Workspace (usually a git repository), registered as a DSH Workspace of its own. Because it is a real Workspace, a Session opened there has it as its working directory: the bash tool, the right sidebar's terminal and files, and AGENTS.md discovery all follow it. This replaces session-hooks' "tell the model about a workdir" workaround for this use case.

```
deepseek-harness-plugins                <- parent Workspace (the repository)
deepseek-harness-plugins/feature-a      <- workbench (a git worktree)
deepseek-harness-plugins/feature-b
workflow
```

## User flow

1. In a parent Workspace, ask for a workbench named `feature-a`.
2. The plugin creates the directory, prepares it, registers it as a Workspace titled `<parent>/feature-a` placed right after its parent, and opens a blank Session there with the right sidebar showing a terminal.
3. The person uses the terminal, files, and browser in the right sidebar; the conversation starts whenever they type.
4. When done, remove the workbench: its Sessions are archived, the directory is cleaned up, and the Workspace is unregistered.

## Where workbenches live

`${XDG_DATA_HOME:-~/.local/share}/dsh-workbench/<parent name>/<workbench name>`, configurable with `root`. The same place for git and non-git parents, so workbenches never clutter a project directory.

## Rules: how a workbench is made and removed

| | Default rule | Repository rule |
|---|---|---|
| Create, git parent | `git worktree add -b <name> <dir>` from the parent's current HEAD | Commands from the parent's `.dsh/workbench.yml` |
| Create, not git | Make an empty directory | Same file |
| Remove, git parent | Remove the worktree when it has no uncommitted changes (otherwise refuse and say why); delete the branch when it is merged | Same file |
| Remove, not git | Ask, then move the directory to the trash | Same file |

The repository rule runs only when the parent is under `trustedDirs`, the same trust model as session-hooks' project hooks. Elsewhere the default rule applies.

```yaml
# <parent>/.dsh/workbench.yml
create:
  - |
    git worktree add -b "$DSH_WORKBENCH_NAME" "$DSH_WORKBENCH_DIR" origin/main
    cd "$DSH_WORKBENCH_DIR" && pnpm install
remove:
  - git worktree remove "$DSH_WORKBENCH_DIR"
```

Commands get `DSH_WORKBENCH_NAME`, `DSH_WORKBENCH_DIR`, `DSH_WORKBENCH_PARENT`, and the same JSON on stdin. They run in the parent directory with a timeout, and every run is logged to `$DSH_HOME/langify-workbench/workbench.log`, as in session-hooks.

## State

`$DSH_HOME/langify-workbench/workbenches.json` maps each workbench to its parent Workspace id and path, directory, Workspace id, branch, and creation time. The plugin keeps it consistent with the Workspace registry: a workbench whose Workspace was deleted by hand is shown as orphaned and can be cleaned up.

## Entry points, in stages

### Stage 1: host only

- A slash command: `/workbench new <name>`, `/workbench list`, `/workbench remove [<name>]`. `ctx.commands.register` runs on the host without creating a model message; DSH records the command in the Session it ran in, so a blank Session used only for the command is archived afterwards.
- The same operations as a model tool (`workbench_create`, `workbench_list`, `workbench_remove`), so "make a workbench for this" also works in conversation.
- An end-to-end test against a real `dsh`, like `e2e/session-hooks`.

### Stage 2: Web UI (feasibility checked, see below)

- A **Workbench** card on the right sidebar's Start page, next to "Workspace files" and "New terminal": enter a name, press Create. The client calls the host, then opens a blank Session in the new Workspace and a terminal tab.
- A **Workbench** global panel (next to Plugins) listing every workbench with its branch and dirty/unpushed state, with Open and Remove.
- "Remove workbench" in the Session row menu for Sessions inside a workbench.

### Stage 3: upstream

- A plugin slot for the Workspace row's "…" menu, mirroring the Session row's (`sidebar.workspaces.session.menu.item`), so "New workbench" can sit there.
- Nested Workspace display.

## Stage 2 feasibility (checked against DSH 0.2.0-rc.2)

| Need | DSH mechanism | Found in |
|---|---|---|
| Ship a browser half | `package.json` declares `dsh.client` (`platform: 'web'`) and exports `./client`; the host serves the built `lib/client.js` under `/plugins` and loads it lazily | `dsh-client-modules` README |
| Shared React and Cordis | Bundles resolve externals against the shell's `PLATFORM_MODULES` table (React, Cordis, static UI libraries); other requests go in `dsh.client.external` | `dsh-client-modules` README |
| Client → host call | Host: `ctx.connection.rpc.handle('/langify-workbench', handler)`, or an exact route with `ctx.connection.fetch.register({ path, methods, fetch })`. Client: `ctx.connection.rpc.call(channel, endpoint, payload)`. Both pass the same browser authentication as DSH's own API | `dsh-client-connection` `lib/types/rpc.d.ts` |
| Start a blank Session in a Workspace | `ctx.uiWorkspace.startSession(workspaceId)`; `openSession(target)` for an existing one | `dsh-client-ui-workspace` `lib/types/client/navigation.d.ts` |
| Open a terminal (or browser) tab | `ctx.sidebarRight.openTab('terminal')`, `openTab('browser')`; the panel expands itself | `dsh-client-ui-sidebar-right` README |
| A card on the Start page | Register a tab type with a `guide` entry through `ctx.sidebarRightTabs.register` | `dsh-client-ui-sidebar-right` README |
| A global panel | An entry in `sidebar.panellist` and the matching `main` keyed slot | `dsh-client-ui-sidebar` README |
| Session row menu item | `sidebar.workspaces.session.menu.item` list slot | `dsh-client-ui-workspace` README |
| New Workspace appears in the sidebar | The Workspace list is a live projection of the host registry, so a host-side `workspaceRegistry.create()` shows up without a reload | `dsh-api-workspace-controller` README |

Conclusion: stage 2 looks feasible with public mechanisms; no DSH change is needed for the card, panel, and menu item.

Risks to resolve when stage 2 starts:

- No published third-party plugin with a client half to copy yet (BrowserSkill's client only uses slots). The `dsh.client` build (tsdown in DSH itself), the exact `PLATFORM_MODULES` list, and versions of React and the UI primitives need a small spike first.
- DSH's own client↔host APIs are generated by Typert (`@deepseek-ai/dsh-typert-generator` is published but undocumented for plugins). The plan is the plain `ctx.connection.rpc` channel instead, which needs no generator.
- The Workspace row "…" menu has no slot (its two items are hard-coded), hence stage 3.
- Client APIs are DSH-internal and still moving in 0.2 release candidates; the end-to-end test must cover them.

## Relation to session-hooks

session-hooks keeps per-Session hooks. Its worktree-per-session examples become optional once workbench exists; a workbench's `.dsh/workbench.yml` covers preparation and cleanup of the place, and `.dsh/hooks.yml` still covers per-Session work.

## Open questions

- Remove for non-git workbenches: trash or delete after confirmation (current choice: trash).
- Whether removing a workbench archives its Sessions or leaves them ungrouped.
- Branch naming default: the workbench name, or `wb/<name>`.
