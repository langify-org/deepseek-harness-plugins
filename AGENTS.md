# AGENTS.md

Conventions for everyone who changes this repository, people and coding agents alike.

## Layout

```
plugins/<name>/        one DSH plugin per directory: the npm package @langify-org/dsh-<name>
  DESIGN.md, docs/     design notes, kept in the repository (not published)
tooling/               the workspace's own tools (not published)
  dsh-plugin-build/    builds a plugin that has several host plugins or a browser module
  dsh-dev/             `pnpm dev`: a development DSH with every plugin installed
e2e/<name>/run.mjs     end-to-end check of that plugin against a real dsh
nix/                   flake builders (plugins.nix, with-dsh.nix)
docs/plugin-guidelines.md  what writing DSH plugins has taught this repository; read it first
docs/upstream/         drafts of proposals to deepseek-ai/deepseek-harness
dev/                   `just dev` configs: <name>.patch.yml and <name>.playground/ per plugin, local.patch.yml (yours)
patches/               patches pnpm applies to dependencies as it installs them, each saying why
scripts/i18n.mjs       keeps the README translations in step
```

A plugin is built in one of two ways, by what it holds:

- **One host module**, as session-hooks: `src/index.ts`, bundled by `build:js` with esbuild into `lib/index.js`, `@deepseek-ai/*` kept external, with declarations from `tsc` (`build:types`). The plugin's own `cordis.patch.yml` inserts it. Its dependencies' versions come from the catalog in `pnpm-workspace.yaml`.
- **Several host plugins, or a browser module for DSH's web client**, as dsh-chrome: its `build.ts` declares them to `@langify-org/dsh-plugin-build`, which builds `dist/`, generates the bundle patch `dist/cordis.patch.yml` from the declaration, and fails the build when a bundle depends on something DSH would not provide. Each process boundary gets its own TypeScript project (`tsconfig.<target>.json`), and a test (dsh-chrome's `test/unit/dependencies.test.ts`) states which part of the code may import which. It pins exact versions in its own `package.json`.

Either way a plugin is one npm package, which DSH installs from npm or from its tarball. `pnpm dev` and the Nix flake take every package under `plugins/` whose `package.json` has a `dsh` field for a plugin, and `pnpm check` builds and tests every package of the workspace.

The parts of a plugin built with dsh-plugin-build, as dsh-chrome lays them out:

| Path | Role |
| --- | --- |
| `package.json` | The published interface: `exports`, the `dsh` field, `engines.dsh`, peer dependencies. The build holds it to the build declaration: exports must point at the build output. |
| `build.ts` | The one place that says what is built from which source. |
| `src/host/` | Cordis plugins DSH runs in its Host process (Node). |
| `src/client/` | The browser module DSH serves to its web client (React). |
| `src/protocol/` | Messages shared by the parts that run in different processes. Uses no Node or DOM API. |
| `test/unit/` | Pure logic, run on every check. |
| `test/compat/` | The built plugin inside DSH's real Host services, at the DSH version `engines.dsh` names. |
| `test/integration/` | Real external software (a browser, a server), run on demand. |
| `test/support/` | What several test files share, such as a DSH Host composition or a headless browser. |
| `docs/` | Design notes: the concepts, the decisions, and why. |

## Rules for a plugin

1. **One bundle per plugin.** A plugin is its own npm package whose `package.json` names its bundle patch (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`), so users enable and remove plugins one by one.
2. **Entries DSH can resolve.** A plugin with one host module writes its own `cordis.patch.yml` and names its entry relative to it (`./lib/index.js`): DSH resolves `./` and `../` names in any patch beside that patch file, so the same file works for `dsh plugin add`, for `--patch` on a checkout, and for the Nix build. Never use an absolute path there. A plugin built with dsh-plugin-build gets a generated patch that names its package and subpaths (`@langify-org/dsh-chrome/tools`), because DSH serves a browser module only for a package installed in a profile; such a plugin loads only installed, from its tarball or with `pnpm dev`, not with `--patch`.
3. **Prefixed ids.** Row ids and Cordis plugin names start with `langify-` (for example `langify-session-hooks`). A patch that overrides a built-in row must say so in the plugin's README. dsh-chrome predates this rule: its rows (`dsh-chrome`, `dsh-chrome-tools`, `dsh-chrome-context`), its Cordis plugin names (those, and `dsh-chrome-viewer`), its service (`chrome`), and its directory in the DSH home (`dsh-chrome/`) keep their names, since renaming them would break the patches that configure them and move the profile it keeps.
4. **Neutral defaults.** The bundle patch carries only defaults that suit everyone, usually `config: {}`. Personal settings belong in the user's own layer. A later layer replaces a row's whole `config`, so the schema must hold every default.
5. **DSH is a peer; everything else is bundled.** `@deepseek-ai/*` packages are `peerDependencies` with the supported range and `devDependencies` (from the catalog, or exact versions), so the plugin shares DSH's own instances; DSH checks the `@deepseek-ai/dsh-*` ranges against its version when it installs or starts a plugin. Any other library is a `devDependency` the build bundles. Never add runtime `dependencies`: the Nix build ships the package without a `node_modules` of its own.
6. **Validate config yourself.** Export a schemastery `Config` for DSH's tooling, and validate again in `apply` (see `resolveConfig` in session-hooks), with errors prefixed by the plugin name.
7. **Make failures visible.** DSH keeps `ctx.logger` output only while it starts up. Report runtime problems where the user will see them: to stderr with a `[langify-<name>]` prefix as well, with a log file under `$DSH_HOME/langify-<name>/` when users need details (session-hooks), or in the plugin's own UI (dsh-chrome tells the sidebar and the settings page what failed, and logs to `ctx.logger` with a `dsh-chrome:` prefix; see `docs/plugin-guidelines.md`).
8. **Never block or crash DSH.** Catch errors in listeners, bound every external process with a timeout, and stop running work in the plugin's `ctx.effect` disposer.

## Code and tests

- Source and tests use erasable TypeScript only (`erasableSyntaxOnly`): no enums, namespaces, or constructor parameter properties. Node runs the tests directly from `.ts` files, and relative imports use the `.ts` extension.
- `tsconfig.base.json` holds the shared, strict settings, with `noEmit`; each package adds the `types` and `lib` of the process its code runs in. A package that emits declarations turns `noEmit` off in its build configuration (session-hooks' `tsconfig.build.json`).
- Biome formats and lints every file: run `pnpm format`. Formatting is Biome's, not the author's.
- **Names say what a thing is.** Use the domain's words, the same word for the same concept everywhere, and rename instead of explaining a misleading name in a comment.
- **Parse what crosses a process boundary.** Messages from another process are parsed into fresh values with the protocol's fields only; never cast them.
- **One definition.** Derive what can be derived (the bundle patch, the list of plugins) instead of keeping a second copy by hand.
- **Comments explain why**, or what a reader cannot see from the code: a platform limit, a protocol rule, a decision and its reason.
- **Tests state behavior.** A test's name is a sentence about what the code does. Cover pure logic with unit tests (`node --test`), and the plugin on a real `new Context()` from `@deepseek-ai/cordis` by emitting the DSH events it listens to (see session-hooks' `test/plugin.test.ts`), or inside DSH's real Host services at the version `engines.dsh` names (dsh-chrome's `test/compat/`).
- `e2e/<name>/run.mjs` runs the plugin in a real `dsh`. Use a throwaway `DSH_HOME`, a free port, and an environment without inherited `DSH_*` variables, plus `DSH_TELEMETRY_DISABLED=1`. Support the three bundle sources (checkout, `DSH_E2E_PLUGIN_PATCH`, `DSH_E2E_TARBALL`). A model request is allowed only behind an opt-in variable such as `DSH_E2E_PROVIDER_PATCH`.
- Tests that drive real external software run on demand: `pnpm test:integration` (dsh-chrome's need Google Chrome, or `DSH_CHROME_TEST_EXECUTABLE`, and TigerVNC's Xvnc and Openbox, which `nix develop` provides).
- Before a pull request, run `pnpm check` (or `just check`): Biome, the README check, every package's type checks and unit tests, the builds, and the tests against DSH's packages. CI and the release workflow run it too. Also run `just e2e <name>`, `pnpm test:integration` and `just nix-check` when behavior, packaging, or dependencies changed.

## Documentation in three languages

- Every README, in the repository root and in each `plugins/<name>/`, exists in English (`README.md`), Japanese (`README.ja.md`), and Simplified Chinese (`README.zh.md`). English is the source; the translations say the same thing, section by section.
- The three files have the same headings at the same levels, and identical code blocks. Keep explanations in prose rather than in code comments, so code never needs translating.
- The first line under the title links the other languages. A published plugin's README is also shown on npm, so its links (language links included) are absolute GitHub URLs.
- `pnpm run docs:check` (part of `pnpm check`) compares each section with the hashes in `.i18n.json` beside it and fails when one language changed without the others. After updating all three, run `pnpm run docs:record`. Never record without translating.
- Use DSH's own terms: in Chinese, 会话 (session), 归档 (archive), 组合包 (bundle), 插件 (plugin), 钩子 (hook), and the **插件** page; in Japanese, セッション, アーカイブ, プラグイン, フック, and the **Plugins** page (the DSH UI has no Japanese locale). A plugin's own UI labels stay as the plugin shows them.
- AGENTS.md, design notes (`plugins/<name>/DESIGN.md`, `plugins/<name>/docs/`), `docs/`, the tooling's READMEs, and `.changeset/` stay in English.

## Never touch the user's own DSH

Development and tests never use the running DSH (port 3080 by default) and never write to `~/.dsh` or its profiles. There are two development DSHs, each with its own home:

- `pnpm dev` builds and packs every plugin, installs the packs into a DSH of its own (`.dsh-home`), as users install them, and serves its web UI on port 3390 (`pnpm dev --port <port>` picks another). On its first start, that DSH asks for a model provider's key, which it keeps in its home. It runs the DSH of the DSH Desktop installed on the machine; `pnpm dsh` runs that DSH's own `dsh` command. It is the way to run a plugin built with dsh-plugin-build, which loads only installed (rule 2); see [tooling/dsh-dev](tooling/dsh-dev/README.md).
- `just dev <plugin> [port]` starts a separate Web UI with one plugin, loaded with `--patch` from its `cordis.patch.yml` and reloaded when its `lib/` changes (`just watch <plugin>`), on port 3091, and opens it in the browser. It has its own home (`.dsh-dev/home`), and its default workspace is a throwaway git repository under `.dsh-dev/documents/` (it sets the workspace controller's `documentsDirectory`), so hooks never touch this checkout or your own DSH workspace.
  - It loads `dev/<plugin>.patch.yml`, the plugin's committed dev config, then `dev/local.patch.yml`. The latter is personal and git-ignored; `just dev-use-profile` makes it a read-only link to the user's own profile patch so the dev UI reaches their model provider.
  - Files in `dev/<plugin>.playground/` are copied into the playground once (for example a project `.dsh/hooks.yml`).
  - `just dev` exports `LANGIFY_DEV_ROOT` (this checkout) and `DSH_WORKTREES_DIR` (`.dsh-dev/worktrees`); dev configs use them instead of absolute paths.

## Working in parallel

- Work on one plugin per branch, ideally in its own `git worktree`. A task's write scope is `plugins/<name>/`, `e2e/<name>/`, `dev/<name>.patch.yml`, and `dev/<name>.playground/`.
- Files shared by every plugin are edited by one task at a time: `pnpm-workspace.yaml` (catalog), `pnpm-lock.yaml`, `nix/plugins.nix` (dependency hash), `flake.lock`, root `package.json`, `tsconfig.base.json`, `biome.jsonc`, `tooling/`, CI workflows, and this file.
- Give each parallel development DSH its own port: `just dev session-hooks 3092`, `pnpm dev --port 3391`.

## Adding a plugin

1. Start with a `DESIGN.md` in `plugins/<name>/` (English; see `plugins/workbench/DESIGN.md`). Until the directory has a `package.json` with a `dsh` field, the Nix flake and `pnpm dev` skip it, and until it has a `package.json`, the README check does. Then copy the shape of the plugin closest to yours: `plugins/session-hooks` for one host module, `plugins/dsh-chrome` for several host plugins or a browser module. Either way: `package.json` (name `@langify-org/dsh-<name>`, `files`, `dsh.bundle`, peers, `engines`; `publishConfig` once it is published), the TypeScript projects, `src/`, tests, `README.md` with its Japanese and Chinese translations, and `LICENSE`.
2. Run `pnpm install`, then update the Nix dependency hash (below).
3. Add `e2e/<name>/run.mjs` when the plugin reacts to DSH behavior that unit tests can only imitate, and `dev/<name>.patch.yml` with a config that shows the plugin working in `just dev`.
4. Add a row to the plugin table in all three root READMEs, run `pnpm run docs:record`, and add a changeset.

The Nix flake, CI and `pnpm dev` pick the new directory up on their own.

## Updating the Nix dependency hash

`nix/plugins.nix` fetches the whole workspace's pnpm dependencies once, by hash. pnpm fetches every platform's optional packages there, so the hash is the same on every system. After any change to `pnpm-lock.yaml`, set `hash` to `sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`, run `nix build .#session-hooks`, and copy the `got:` value into `hash`. Flakes only see files git tracks, so `git add` new files first.

`nix flake check` builds every plugin (each runs its own type checks and tests, those of the workspace packages it is built with, and its tests against DSH's packages) and the `workspace` check (Biome, the README check, and every package's type checks and tests). A plugin's result holds its npm tarball and the same package unpacked under `lib/dsh-plugins/<dir>`.

## Upgrading DSH

The plugins are developed against different DSH versions for now: session-hooks against 0.2.0-rc.2 (the catalog, and the `dsh` CI installs), dsh-chrome against 0.2.1-rc.2 (its exact devDependencies, and `engines.dsh`). Moving one plugin is the same steps, for its own part.

1. In `pnpm-workspace.yaml`, set the `@deepseek-ai/*` catalog entries to the new DSH version; in `plugins/dsh-chrome/package.json`, its `@deepseek-ai/*` devDependencies and `engines.dsh`.
2. Widen or move the `peerDependencies` ranges of every plugin, then `pnpm install` and update the Nix hash.
3. Update the `dsh` version in `.github/workflows/ci.yml`.
4. Run `pnpm check`, then the E2E checks against the new `dsh` (`DSH_BIN=/path/to/dsh just e2e <name>`) and `pnpm test:integration`. Read the DSH release notes for the events and services each plugin relies on; session-hooks documents them in its README, under "How it works", and dsh-chrome in `plugins/dsh-chrome/docs/design.md` and `docs/plugin-guidelines.md`.

## Releasing

- Each pull request that changes a published plugin's behavior adds a changeset (`just changeset`). The release workflow opens a "Version packages" pull request, and merging it publishes to npm with provenance.
- A plugin whose `package.json` says `"private": true` is not published: dsh-chrome is installed from its tarball for now. Changesets neither versions nor tags private packages (`privatePackages` in `.changeset/config.json`), so bump such a plugin's `version` by hand whenever its behavior changes: DSH installs from the tarball and does not notice a changed tarball with the same version (`pnpm dev` names each pack by its content, so the development DSH does).
- The workflow publishes through npm trusted publishing (OIDC, no token). pnpm then adds provenance by itself, because the repository is public, so do not set `publishConfig.provenance`: outside CI it makes `pnpm publish` fail.
- npm configures a trusted publisher per package, and only for a package that already exists, so publish each new plugin's first version by hand: `npm login`, then `pnpm --filter ./plugins/<name> publish --access public`. Then add the trusted publisher from the CLI: `npm trust github @langify-org/dsh-<name> --file release.yml --repo langify-org/deepseek-harness-plugins --allow-publish` (try it with `--dry-run` first).
- The `@langify-org` npm organization owns the packages.
