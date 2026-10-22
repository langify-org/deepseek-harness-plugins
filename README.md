# DeepSeek Harness plugins

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH),
developed in one workspace to one standard: strict TypeScript, tests against DSH's own
packages, and reproducible builds.

| Plugin | What it does |
| --- | --- |
| [dsh-chrome](plugins/dsh-chrome/README.md) | Shares a real Chrome between you and the agent in DSH's right sidebar: a Chrome of its own, on a profile of its own, whose whole window the sidebar shows. |

## Using a plugin

Each plugin is an npm package that DSH installs from its tarball. Build one with Nix:

```console
nix build .#dsh-chrome
```

The build runs the workspace's lint, type checks and tests first, then leaves the
tarball in `result/`. In DSH, open **Plugins → Add plugin** and give the tarball's path.
Each plugin's README covers its own setup.

## Developing

```console
nix develop          # Node 24, pnpm, and Xvnc and Openbox for dsh-chrome's Chrome
pnpm install
pnpm dev             # run a development DSH with every plugin of the workspace installed
pnpm check           # lint, type checks, unit tests, build, tests against DSH's packages
```

`pnpm dev` builds the plugins, installs them into a DSH of its own, and serves DSH's web
UI; run it again after a change. That DSH keeps its profiles, sessions and keys in
`.dsh-home`, apart from the DSH you use every day. It runs on the DSH Desktop installed on
this machine; see [dsh-dev](tooling/dsh-dev/README.md) for the details.

Node runs the TypeScript sources directly, so tests and build scripts need no compile
step. See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions every plugin follows,
and [docs/plugin-guidelines.md](docs/plugin-guidelines.md) for what this workspace has
learned about writing DSH plugins.

## Layout

| Path | Contents |
| --- | --- |
| `plugins/<name>/` | One DSH plugin: one npm package, built into its own tarball. |
| [`tooling/dsh-plugin-build/`](tooling/dsh-plugin-build/README.md) | Builds a plugin package into what DSH loads: host bundles, the browser module, the bundle patch. |
| [`tooling/dsh-dev/`](tooling/dsh-dev/README.md) | Runs a development DSH with the workspace's plugins installed (`pnpm dev`). |
| `nix/` | The Nix build of the workspace and its plugins. |
| `docs/` | Guidance that applies to every plugin. |
| `.dsh-home/` | The development DSH's home, created by `pnpm dev` and kept out of git. |

## License

[MIT](LICENSE)
