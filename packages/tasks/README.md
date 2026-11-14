# @langify-org/dsh-tasks

English | [日本語](README.ja.md) | [中文](README.zh.md)

Run the recipes of a [justfile](https://just.systems) from a **Tasks** tab in DeepSeek Harness's right sidebar. Each recipe has a Run button; the command runs in a new tab of DSH's own terminal.

## Requirements

- DSH `>=0.2.2-rc.2 <0.3.0-0` with the Web UI.
- [`just`](https://just.systems) on the host's `PATH`. Parameter help, options, and flags come from `[arg(...)]` attributes, which recent `just` releases support; with an older release, recipes are listed without them.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-tasks
```

In DSH Web and Desktop you can also add it from the **Plugins** page.

## Settings

| Setting | Default    | What it is                                                                                                                                             |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runIn` | `terminal` | Where a recipe runs: `terminal`, a new terminal tab; or `tmux`, a new window of the conversation's tmux session, with [@langify-org/dsh-tmux](../tmux) |

## Usage

Open **Tasks** from the right sidebar's guide. It lists the public recipes of the justfile that `just` finds from the session's working folder, or a folder above it, with each recipe's doc comment and its parameters in `just`'s notation (`target mode=debug [--verbose] *rest`).

- Click a recipe to run it: a new terminal tab opens and `just <recipe>` is typed into it. Stop a recipe with Ctrl-C in that terminal.
- **In tmux**: with `runIn: tmux` and the tmux plugin running, the recipe runs in a new window of the conversation's tmux session instead, and the **tmux** tab opens on that window. Without the tmux plugin, recipes run in a terminal tab.
- Clicking a recipe with parameters opens its arguments under the row instead. Literal defaults are filled in, a flag is a checkbox, and a variadic parameter (`*rest`, `+rest`) takes space-separated values; a parameter's help shows on hover. Enter runs it and Esc closes the arguments. `just` checks the values, including `pattern`s.
- The list reads the justfile again whenever you come back to the window. A justfile in a folder above the session's is named under the list.

Recipes starting with `_` or marked `[private]`, and recipes of `mod` submodules, are not listed. The model is not told about runs in a terminal tab, and their output stays outside its history. A run in tmux is a tmux window like any other: the model sees it at the start of its next turn and can read it.

## Safety

A Run click is the same as typing `just <recipe>` yourself: it runs with your user's permissions, outside the agent's sandbox, and the command is shown in the terminal. Listing recipes runs no code from the justfile. Form values are typed into an interactive shell, so each one is single-quoted, and values with control characters (which the terminal acts on even inside quotes) are refused.

## How it works

The host plugin runs `just --dump --dump-format json` in the session's working folder and returns the recipes. With `runIn: tmux`, the host instead passes the command line to the `langifyTmux` service of the tmux plugin, found with `ctx.get` at run time (neither package imports the other), and the browser opens the tab kind it returns. Otherwise the browser half opens a terminal tab with the right sidebar's `openTab('terminal')`, takes that tab's terminal model from `ctx.webTerminals`, waits until it is connected and writable, and writes the command line followed by Enter.

## Known limitations

- **Undocumented terminal access**: `ctx.webTerminals` is the terminal tab's own service, not a documented plugin API, so a DSH update may break Run.
- **Text fields only**: a `pattern` such as `debug|release` is not yet offered as a choice.

## Verifying in a browser

`pnpm dev` from the repository root, then in a session whose folder has a justfile:

1. Open **Tasks** from the right sidebar's guide. The recipes appear with their parameters.
2. Click a recipe without parameters. A terminal tab opens and runs `just <recipe>`.
3. On a recipe with parameters, fill the form with a value such as `a b; echo hi` and run it. The recipe receives the value unchanged, and `echo hi` does not run.
4. Run a long recipe and stop it with Ctrl-C in the terminal.
