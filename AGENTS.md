# AGENTS.md

Conventions for everyone who changes this repository, people and coding agents alike.

## Layout

```
plugins/<name>/        one published DSH bundle per directory: @langify-org/dsh-<name>
  package.json         declares dsh.bundle; peers on @deepseek-ai/*
  cordis.patch.yml     inserts the plugin row with a relative entry (./lib/index.js)
  src/  test/          TypeScript source and node:test tests
  examples/ README*.md shipped with the package (README in en, ja, zh)
e2e/<name>/run.mjs     end-to-end check of that plugin against a real dsh
nix/                   flake builders (plugins.nix, with-dsh.nix)
docs/upstream/         drafts of proposals to deepseek-ai/deepseek-harness
dev/                   `just dev` configs: <name>.patch.yml and <name>.playground/ per plugin, local.patch.yml (yours)
scripts/i18n.mjs       keeps the README translations in step
```

## Rules for a plugin

1. **One bundle per plugin.** A plugin is its own npm package with `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, so users enable and remove plugins one by one.
2. **Relative entry.** The bundle patch names the plugin as `./lib/index.js`. DSH resolves `./` and `../` names in any patch beside that patch file, so the same file works for `dsh plugin add`, for `--patch` on a checkout, and for the Nix build. Never use the package name or an absolute path there.
3. **Prefixed ids.** Row ids and Cordis plugin names start with `langify-` (for example `langify-session-hooks`). A patch that overrides a built-in row must say so in the plugin's README.
4. **Neutral defaults.** The bundle patch carries only defaults that suit everyone, usually `config: {}`. Personal settings belong in the user's own layer. A later layer replaces a row's whole `config`, so the schema must hold every default.
5. **DSH is a peer; everything else is bundled.** `@deepseek-ai/*` packages are `peerDependencies` with the supported range (`^0.2.0-rc.2` while DSH is 0.2) and `devDependencies` as `catalog:`, so the plugin shares DSH's own instances; DSH checks the `@deepseek-ai/dsh-*` ranges against its version when it installs or starts a plugin. Any other library (session-hooks uses `js-yaml`) is a `devDependency` that `build:js` bundles into `lib/index.js` with esbuild, keeping `@deepseek-ai/*` external. Never add runtime `dependencies`: the Nix build ships `lib/` without a `node_modules` of its own.
6. **Validate config yourself.** Export a schemastery `Config` for DSH's tooling, and validate again in `apply` (see `resolveConfig` in session-hooks), with errors prefixed by the plugin name.
7. **Make failures visible.** DSH keeps `ctx.logger` output only while it starts up. Report runtime problems to stderr with a `[langify-<name>]` prefix as well, and keep a log file under `$DSH_HOME/langify-<name>/` when users need details.
8. **Never block or crash DSH.** Catch errors in listeners, bound every external process with a timeout, and stop running work in the plugin's `ctx.effect` disposer.

## TypeScript and tests

- Source and tests use erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces, or constructor parameter properties. Node runs the tests directly from `.ts` files, and relative imports use the `.ts` extension.
- `build` emits declarations with `tsc` (`build:types`) and the single `lib/index.js` with esbuild (`build:js`). The repository uses `esbuild-wasm`, which has no platform-specific binary, so the Nix dependency hash is the same on every system.
- `pnpm --filter ./plugins/<name> run test` runs `node --test`. Cover pure logic with unit tests and the plugin on a real `new Context()` from `@deepseek-ai/cordis` by emitting the DSH events it listens to (see `test/plugin.test.ts`).
- `e2e/<name>/run.mjs` runs the plugin in a real `dsh`. Use a throwaway `DSH_HOME`, a free port, and an environment without inherited `DSH_*` variables, plus `DSH_TELEMETRY_DISABLED=1`. Support the three bundle sources (checkout, `DSH_E2E_PLUGIN_PATCH`, `DSH_E2E_TARBALL`). A model request is allowed only behind an opt-in variable such as `DSH_E2E_PROVIDER_PATCH`.
- Before a pull request, run `just check`. Also run `just e2e <name>` and `just nix-check` when behavior, packaging, or dependencies changed.

## Documentation in three languages

- Every README, in the repository root and in each `plugins/<name>/`, exists in English (`README.md`), Japanese (`README.ja.md`), and Simplified Chinese (`README.zh.md`). English is the source; the translations say the same thing, section by section.
- The three files have the same headings at the same levels, and identical code blocks. Keep explanations in prose rather than in code comments, so code never needs translating.
- The first line under the title links the other languages. A plugin README is also shown on npm, so its links (language links included) are absolute GitHub URLs.
- `pnpm run docs:check` (part of `just check`) compares each section with the hashes in `.i18n.json` beside it and fails when one language changed without the others. After updating all three, run `pnpm run docs:record`. Never record without translating.
- Use DSH's own terms: in Chinese, 会话 (session), 归档 (archive), 组合包 (bundle), 插件 (plugin), 钩子 (hook), and the **插件** page; in Japanese, セッション, アーカイブ, プラグイン, フック, and the **Plugins** page (the DSH UI has no Japanese locale).
- AGENTS.md, `docs/upstream/`, and `.changeset/` stay in English.

## Never touch the user's own DSH

Development and tests never use the running DSH (port 3080 by default) and never write to `~/.dsh` or its profiles.

- `just dev <plugin> [port]` starts a separate Web UI on port 3091 and opens it in the browser. It has its own home (`.dsh-dev/home`), and its default workspace is a throwaway git repository under `.dsh-dev/documents/` (it sets the workspace controller's `documentsDirectory`), so hooks never touch this checkout or your own DSH workspace.
- It loads `dev/<plugin>.patch.yml`, the plugin's committed dev config, then `dev/local.patch.yml`. The latter is personal and git-ignored; `just dev-use-profile` makes it a read-only link to the user's own profile patch so the dev UI reaches their model provider.
- Files in `dev/<plugin>.playground/` are copied into the playground once (for example a project `.dsh/hooks.yml`).
- `just dev` exports `LANGIFY_DEV_ROOT` (this checkout) and `DSH_WORKTREES_DIR` (`.dsh-dev/worktrees`); dev configs use them instead of absolute paths.

## Working in parallel

- Work on one plugin per branch, ideally in its own `git worktree`. A task's write scope is `plugins/<name>/`, `e2e/<name>/`, `dev/<name>.patch.yml`, and `dev/<name>.playground/`.
- Files shared by every plugin are edited by one task at a time: `pnpm-workspace.yaml` (catalog), `pnpm-lock.yaml`, `nix/plugins.nix` (dependency hash), `flake.lock`, root `package.json`, CI workflows, and this file.
- Give each parallel `just dev` its own port: `just dev session-hooks 3092`.

## Adding a plugin

1. Copy the shape of `plugins/session-hooks`: `package.json` (name `@langify-org/dsh-<name>`, `files`, `dsh.bundle`, peers, `publishConfig`), `cordis.patch.yml`, both tsconfig files, `src/index.ts` exporting `name`, `Config`, and `apply`, tests, `README.md` with its Japanese and Chinese translations, and `LICENSE`.
2. Run `pnpm install`, then update the Nix dependency hash (below).
3. Add `e2e/<name>/run.mjs` when the plugin reacts to DSH behavior that unit tests can only imitate, and `dev/<name>.patch.yml` with a config that shows the plugin working in `just dev`.
4. Add a row to the plugin table in all three root READMEs, run `pnpm run docs:record`, and add a changeset.

The Nix flake and CI pick the new directory up on their own.

## Updating the Nix dependency hash

`nix/plugins.nix` fetches the whole workspace's pnpm dependencies once, by hash. After any change to `pnpm-lock.yaml`, set `hash` to `sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`, run `nix build .#session-hooks`, and copy the `got:` value into `hash`. Flakes only see files git tracks, so `git add` new files first.

## Upgrading DSH

1. In `pnpm-workspace.yaml`, set the `@deepseek-ai/*` catalog entries to the new DSH version.
2. Widen or move the `peerDependencies` ranges of every plugin, then `pnpm install` and update the Nix hash.
3. Update the `dsh` version in `.github/workflows/ci.yml`.
4. Run `just check`, then the E2E checks against the new `dsh` (`DSH_BIN=/path/to/dsh just e2e <name>`). Read the DSH release notes for the events and services each plugin relies on; session-hooks documents them in its README, under "How it works".

## Releasing

- Each pull request that changes a plugin's behavior adds a changeset (`just changeset`). The release workflow opens a "Version packages" pull request, and merging it publishes to npm with provenance.
- The workflow publishes through npm trusted publishing (OIDC, no token). pnpm then adds provenance by itself, because the repository is public, so do not set `publishConfig.provenance`: outside CI it makes `pnpm publish` fail.
- npm configures a trusted publisher per package, and only for a package that already exists, so publish each new plugin's first version by hand: `npm login`, then `pnpm --filter ./plugins/<name> publish --access public`. Then add the trusted publisher from the CLI: `npm trust github @langify-org/dsh-<name> --file release.yml --repo langify-org/deepseek-harness-plugins --allow-publish` (try it with `--dry-run` first).
- The `@langify-org` npm organization owns the packages.
