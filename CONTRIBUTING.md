# Contributing

## Setting up

```console
nix develop          # Node 24, pnpm, and Xvfb for the browser tests
pnpm install
```

Without Nix, install Node.js 24 and the pnpm version `packageManager` in `package.json`
names; the browser tests also need Google Chrome and Xvfb.

## Trying plugins in DSH

```console
pnpm dev
```

This builds every plugin, installs them into a development DSH, and serves DSH's web UI.
Run it again after a change: it installs only the plugins that changed. The development
DSH keeps its home in `.dsh-home`, apart from the DSH you use every day; on first start,
DSH asks for a model provider's key, which it keeps there. `pnpm dsh` runs that DSH's own
`dsh` command, for example `pnpm dsh plugin --profile web list`.

`pnpm dev` needs DSH Desktop installed on the machine, whose DSH it runs; see
[dsh-dev](tooling/dsh-dev/README.md) for how it finds DSH and what it does.

## Checks

`pnpm check` runs what the Nix build runs: Biome, the type checks of every package, unit
tests, the build, and each plugin's tests against DSH's own packages (`test:compat`).
Tests that drive a real browser run separately:

```console
pnpm build
pnpm test:integration    # needs Chrome (or DSH_CHROME_TEST_EXECUTABLE) and Xvfb
```

`nix build .#<plugin>` runs the same checks in a sandbox before packing the tarball.

## Adding a plugin

Every package under `plugins/` whose `package.json` has a `dsh` field is a plugin of the
workspace: Nix packages it as `.#<directory>`, and `pnpm dev` installs it. Start from
[dsh-chrome](plugins/dsh-chrome/) for the layout below, and read
[docs/plugin-guidelines.md](docs/plugin-guidelines.md) first: DSH has rules that are easy to
miss and costly to discover.

## A plugin package

A plugin lives in `plugins/<name>/` and is one npm package. Its parts:

| Path | Role |
| --- | --- |
| `package.json` | The published interface: `exports`, the `dsh` field, `engines.dsh`, peer dependencies. |
| `build.ts` | The one place that says what is built from which source, through `@langify-org/dsh-plugin-build`. |
| `src/host/` | Cordis plugins DSH runs in its Host process (Node). |
| `src/client/` | The browser module DSH serves to its web client (React). |
| `src/protocol/` | Messages shared by the parts that run in different processes. Uses no Node or DOM API. |
| `test/unit/` | Pure logic, run on every check. |
| `test/compat/` | The built plugin inside DSH's real Host services, at the DSH version `engines.dsh` names. |
| `test/integration/` | Real external software (a browser, a server), run on demand. |
| `test/support/` | What several test files share, such as a DSH Host composition or a headless browser. |
| `docs/` | Design notes: the concepts, the decisions, and why. |

Every process boundary gets its own TypeScript project (`tsconfig.<target>.json`), so
code cannot use an API its runtime lacks.

The build tool holds `package.json` to the build declaration: exports must point at the
build output, the bundle patch is generated from the declared host plugins, and a build
fails when a bundle depends on something DSH would not provide at run time.

## Conventions

- **Names say what a thing is.** Use the domain's words, the same word for the same
  concept everywhere, and rename instead of explaining a misleading name in a comment.
- **Parse what crosses a process boundary.** Messages from another process are parsed into
  fresh values with the protocol's fields only; never cast them.
- **One definition.** Derive what can be derived (the bundle patch, the extension
  manifest's version, the list of plugins) instead of keeping a second copy by hand.
- **Comments explain why**, or what a reader cannot see from the code: a platform limit,
  a protocol rule, a decision and its reason.
- **Tests state behavior.** A test's name is a sentence about what the code does.
- **Formatting is Biome's.** Run `pnpm format`.

## Versions

A plugin declares the DSH versions it supports in `engines.dsh`, and its compatibility
test runs against DSH's packages of that version. Bump a plugin's `version` whenever its
behavior changes: DSH installs from the tarball and does not notice a changed tarball
with the same version. (`pnpm dev` names each pack by its content, so the development
DSH does notice.)
