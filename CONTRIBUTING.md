# Contributing

English | [日本語](CONTRIBUTING.ja.md) | [中文](CONTRIBUTING.zh.md)

## Setup

With [Nix](https://nixos.org) and [direnv](https://direnv.net):

```sh
direnv allow
pnpm install
```

Without Nix, install the official Node.js build named in [`.node-version`](.node-version) and pnpm 11 (the version in `package.json`'s `packageManager`). DSH cannot boot on Node builds compiled from source, such as nixpkgs' `nodejs`; the dev shell therefore ships the official binary.

## Commands

| Command           | What it does                                                                 |
| ----------------- | ---------------------------------------------------------------------------- |
| `pnpm check`      | Everything CI runs, in order. Run it before opening a pull request.          |
| `pnpm dev`        | Runs DSH Web with every plugin linked and reloads plugins on change.         |
| `pnpm format`     | Formats files with oxfmt.                                                    |
| `pnpm lint`       | Type-aware lint with oxlint.                                                 |
| `pnpm typecheck`  | Type-checks with TypeScript 7 (tsgo).                                        |
| `pnpm test`       | Runs unit tests with Vitest.                                                 |
| `pnpm build`      | Builds every package with tsdown.                                            |
| `pnpm publint`    | Checks each package's published shape.                                       |
| `pnpm docs:check` | Checks that every document has Japanese and Chinese translations.            |
| `pnpm smoke`      | Installs every plugin into a throwaway DSH home and checks its bundle layer. |

A pre-commit hook (lefthook) formats and lints staged files.

## Development loop

`pnpm dev` keeps DSH state in `.dsh/`, separate from your own DSH installation. It builds the packages, links them into the `web` profile there, starts `tsdown --watch`, and starts DSH Web. Saving a source file rebuilds the package and DSH's HMR replaces the running plugin without a restart. Arguments after `pnpm dev` go to `dsh web`, for example `pnpm dev --port 3081`.

The model needs an API key. Put it in `.envrc.local`, which git ignores and direnv loads:

```sh
export DEEPSEEK_API_KEY=...
```

Another provider can be configured from the Settings page; its configuration also stays in `.dsh/`. Delete `.dsh/` to start over.

## Adding a plugin

1. Copy `packages/greet` to `packages/<name>`, rename the package to `@langify-org/dsh-<name>`, remove `"private": true`, and add `"publishConfig": { "access": "public" }`. Update `repository.directory`, `homepage`, and `description`.
2. Give the plugin row in `cordis.patch.yml` an id prefixed with `langify-`, so it cannot collide with rows from other bundles.
3. List DSH packages the plugin shares with the host under both `peerDependencies` (a range) and `devDependencies` (`catalog:`). Add new DSH packages to the catalog in `pnpm-workspace.yaml`.
4. Keep `engines.dsh` equal to the range the plugin is tested against.
5. Write the README in English, Japanese, and Chinese, and add the plugin to the table in the root README.
6. For a browser half, build `src/client/index.tsx` with `clientBundle()` from [`tsdown.client.ts`](tsdown.client.ts), declare `dsh.client`, export `./client` as `./dist/client.cjs`, and type-check it with `src/client/tsconfig.json` through a `typecheck` script. [`packages/code-server`](packages/code-server) is the example.

`pnpm dev` and `pnpm smoke` pick up every package that declares `dsh.bundle`.

## Releasing

1. A pull request that changes a published package adds a changeset: run `pnpm changeset`, pick the packages and the kind of change, and commit the file it writes.
2. On `main`, the Release workflow keeps a **Version Packages** pull request up to date; it bumps versions and writes each package's `CHANGELOG.md`. Merging it publishes the new versions to npm from CI, with provenance and no stored token.
3. The first version of a new package is published by a maintainer, because npm needs the package to exist before trusting CI: run `pnpm build`, then `pnpm publish` in the package directory. Then, on npmjs.com, add this repository's `release.yml` workflow as the package's trusted publisher.

## Conventions

- **Types**: the shared `tsconfig.base.json` is strict, including `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `isolatedDeclarations`. Exported values need explicit types; this lets tsdown emit declarations with oxc instead of the TypeScript API, which TypeScript 7 does not provide. Host and browser code are separate programs (the root `tsconfig.json` and each package's `src/client/tsconfig.json`), because DSH declares different services on the same Cordis `Context` for each side.
- **Types before tests**: express in types whatever the compiler can check: contracts as interfaces, closed sets as unions, maps that must cover every member as `Record<Union, …>` (the code-server translations cover every error code this way), and, at each trust boundary, a runtime validator annotated with the interface it checks. Write tests only for what types cannot express: timing, I/O, parsing untrusted input, security checks, and protocol edge cases. Do not test what the compiler already guarantees or one-line wiring. A test must fail when the behavior it names breaks.
- **Integration**: `pnpm smoke` checks that DSH composes each bundle. Checks that need a browser or another program are listed in the package's README.
- **Lint**: lint errors are not suppressed inline. When a rule is wrong for a whole kind of file, change `.oxlintrc.json`, say why in a comment there, and explain it in the pull request.
- **Packages**: ESM only. Published packages contain built files only and run no install scripts.
- **DSH versions**: the catalog in `pnpm-workspace.yaml` pins the DSH version used for development and CI, which is the lower bound of `engines.dsh`. Updating DSH means changing the catalog, then each `engines.dsh` and peer range.
- **Docs**: English is the source of truth. A change to an English document updates its `.ja.md` and `.zh.md` translations in the same pull request.
