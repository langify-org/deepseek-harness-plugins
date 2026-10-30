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

1. Copy `packages/greet` to `packages/<name>`, rename the package to `@langify-org/dsh-<name>`, and remove `"private": true`. Update `repository.directory`, `homepage`, and `description`.
2. Give the plugin row in `cordis.patch.yml` an id prefixed with `langify-`, so it cannot collide with rows from other bundles.
3. List DSH packages the plugin shares with the host under both `peerDependencies` (a range) and `devDependencies` (`catalog:`). Add new DSH packages to the catalog in `pnpm-workspace.yaml`.
4. Keep `engines.dsh` equal to the range the plugin is tested against.
5. Write the README in English, Japanese, and Chinese, and add the plugin to the table in the root README.

`pnpm dev` and `pnpm smoke` pick up every package that declares `dsh.bundle`.

## Conventions

- **Types**: the shared `tsconfig.base.json` is strict, including `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `isolatedDeclarations`. Exported values need explicit types; this lets tsdown emit declarations with oxc instead of the TypeScript API, which TypeScript 7 does not provide.
- **Lint**: lint errors are not suppressed inline. When a rule is wrong for a whole kind of file, change `.oxlintrc.json` and explain why in the pull request.
- **Tests**: test plugin logic directly, without booting DSH. `pnpm smoke` covers the integration with DSH.
- **Packages**: ESM only. Published packages contain built files only and run no install scripts.
- **DSH versions**: the catalog in `pnpm-workspace.yaml` pins the DSH version used for development and CI, which is the lower bound of `engines.dsh`. Updating DSH means changing the catalog, then each `engines.dsh` and peer range.
- **Docs**: English is the source of truth. A change to an English document updates its `.ja.md` and `.zh.md` translations in the same pull request.
