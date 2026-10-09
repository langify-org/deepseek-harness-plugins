# AGENTS.md

Conventions for everyone who changes this repository, people and coding agents alike.

## Layout

```
plugins/<name>/        one published DSH bundle per directory: @langify/dsh-<name>
  package.json         declares dsh.bundle; peers on @deepseek-ai/*
  cordis.patch.yml     inserts the plugin row with a relative entry (./lib/index.js)
  src/  test/          TypeScript source and node:test tests
  examples/ README*.md shipped with the package (README in en, ja, zh)
e2e/<name>/run.mjs     end-to-end check of that plugin against a real dsh
nix/                   flake builders (plugins.nix, with-dsh.nix)
docs/upstream/         drafts of proposals to deepseek-ai/deepseek-harness
dev/                   examples for local development patches
scripts/i18n.mjs       keeps the README translations in step
```

## Rules for a plugin

1. **One bundle per plugin.** A plugin is its own npm package with `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, so users enable and remove plugins one by one.
2. **Relative entry.** The bundle patch names the plugin as `./lib/index.js`. DSH resolves `./` and `../` names in any patch beside that patch file, so the same file works for `dsh plugin add`, for `--patch` on a checkout, and for the Nix build. Never use the package name or an absolute path there.
3. **Prefixed ids.** Row ids and Cordis plugin names start with `langify-` (for example `langify-session-hooks`). A patch that overrides a built-in row must say so in the plugin's README.
4. **Neutral defaults.** The bundle patch carries only defaults that suit everyone, usually `config: {}`. Personal settings belong in the user's own layer. A later layer replaces a row's whole `config`, so the schema must hold every default.
5. **Runtime imports are DSH peers only.** Import only Node built-ins and `@deepseek-ai/*` packages at runtime. List those in `peerDependencies` with the supported range (`^0.2.0-rc.2` while DSH is 0.2) and in `devDependencies` as `catalog:`. DSH checks `@deepseek-ai/dsh-*` peer ranges against its own version when it installs or starts a plugin. Do not add runtime `dependencies`: the Nix build ships `lib/` without a `node_modules` of its own. Type-only imports (`import type`) need only the dev dependency.
6. **Validate config yourself.** Export a schemastery `Config` for DSH's tooling, and validate again in `apply` (see `resolveConfig` in session-hooks), with errors prefixed by the plugin name.
7. **Make failures visible.** DSH keeps `ctx.logger` output only while it starts up. Report runtime problems to stderr with a `[langify-<name>]` prefix as well, and keep a log file under `$DSH_HOME/langify-<name>/` when users need details.
8. **Never block or crash DSH.** Catch errors in listeners, bound every external process with a timeout, and stop running work in the plugin's `ctx.effect` disposer.

## TypeScript and tests

- Source and tests use erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces, or constructor parameter properties. Node runs the tests directly from `.ts` files, and relative imports use the `.ts` extension; `tsc` rewrites them to `.js` for `lib/`.
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

Development and tests never use the running DSH (port 3080 by default), `~/.dsh`, or its profiles. `just dev <plugin> [port]` starts a separate Web UI with `.dsh-dev/home` as its home on port 3091. Personal patches go in `dev/local.patch.yml`, which git ignores.

## Working in parallel

- Work on one plugin per branch, ideally in its own `git worktree`. A task's write scope is `plugins/<name>/` plus `e2e/<name>/`.
- Files shared by every plugin are edited by one task at a time: `pnpm-workspace.yaml` (catalog), `pnpm-lock.yaml`, `nix/plugins.nix` (dependency hash), `flake.lock`, root `package.json`, CI workflows, and this file.
- Give each parallel `just dev` its own port: `just dev session-hooks 3092`.

## Adding a plugin

1. Copy the shape of `plugins/session-hooks`: `package.json` (name `@langify/dsh-<name>`, `files`, `dsh.bundle`, peers, `publishConfig`), `cordis.patch.yml`, both tsconfig files, `src/index.ts` exporting `name`, `Config`, and `apply`, tests, `README.md` with its Japanese and Chinese translations, and `LICENSE`.
2. Run `pnpm install`, then update the Nix dependency hash (below).
3. Add `e2e/<name>/run.mjs` when the plugin reacts to DSH behavior that unit tests can only imitate.
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
- The workflow publishes through npm trusted publishing (OIDC, no token). npm configures a trusted publisher per package, and only for a package that already exists, so publish each new plugin's first version by hand: `npm login`, then `pnpm --filter ./plugins/<name> publish --access public`. After that, add the trusted publisher on npmjs.com (repository `langify-org/deepseek-harness-plugins`, workflow `release.yml`).
- The `@langify` npm organization owns the packages.
