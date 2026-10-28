# DeepSeek Harness plugins by langify

English | [日本語](README.ja.md) | [简体中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), as the npm packages `@langify-org/dsh-*`.

| Plugin | What it does |
|---|---|
| [`@langify-org/dsh-session-hooks`](plugins/session-hooks) | Runs shell commands from your config, or from a trusted project's `.dsh/hooks.yml`, when a session starts, is archived, or is restored. For example, it can give every session its own git worktree. |
| [`@langify-org/dsh-chrome`](plugins/dsh-chrome) | Shares a real Chrome between you and the agent in DSH's right sidebar: a Chrome of its own, on a profile of its own (or a copy of one of yours), with a window for each session, which that session's sidebar shows. Linux only, and not on npm yet. |

Every plugin is an ordinary DSH **bundle**: an npm package whose `package.json` declares `dsh.bundle`, the patch that inserts the plugin. session-hooks' patch names the plugin by a path relative to itself (`./lib/index.js`), so the same package works with every way DSH can load it. dsh-chrome's names its package, since DSH serves its browser part only to a package installed in a profile: install it, from its tarball.

The plugins are experimental (0.x) while DSH itself is a release candidate. Each plugin's README says what it relies on.

## Install

### npm (recommended)

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

You can also install it by name from the Web UI's **Plugins** page. Then configure the plugin as its README describes. dsh-chrome is not on npm yet: install it from its tarball, as below.

### Tarball or checkout

```sh
dsh plugin --profile web add ./langify-org-dsh-session-hooks-0.1.0.tgz
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml
```

The first line installs a tarball made with `pnpm pack` or by the Nix build below; `nix build .#dsh-chrome` leaves dsh-chrome's in `result/`, which you can also give to **Add plugin** on the **Plugins** page. The second line loads a built checkout directly, without installing it; dsh-chrome loads only installed.

### Nix

The flake builds each plugin from source and runs its tests. A plugin's result holds its npm tarball and the same package unpacked. `lib.mkPlugins` wires each plugin that loads with `--patch` (session-hooks) to your DSH installation's own modules; install dsh-chrome from the tarball in its result. Add the input to your flake. Do not make it follow your `nixpkgs`: the flake's pinned nixpkgs is the one CI tests, and another pnpm version can change the dependency hash.

```nix
inputs.dsh-plugins.url = "github:langify-org/deepseek-harness-plugins";
```

Then pass the plugin's patch where you build the `dsh` command line:

```nix
let
  dshPlugins = inputs.dsh-plugins.lib.mkPlugins {
    inherit pkgs;
    dshNodeModules = "${deepseekHarness}/lib/deepseek-harness/node_modules";
  };
  hookConfig = pkgs.writeText "session-hooks.patch.yml" (builtins.toJSON [
    { id = "langify-session-hooks"; config.sessionStart = [ "~/.config/dsh/hooks/start.sh" ]; }
  ]);
in
"dsh web --patch ${dshPlugins.session-hooks.patch} --patch ${hookConfig}"
```

`mkPlugins { inherit pkgs; }` without `dshNodeModules` gives the plain builds, which are also `packages.<system>.<plugin>`.

## Develop

Requirements: Node.js 24, pnpm 12, and `dsh` 0.2 for `just e2e` and `just dev`; for dsh-chrome, Google Chrome, TigerVNC's Xvnc, and Openbox. `nix develop` provides Node.js, pnpm, just, Xvnc, and Openbox.

```sh
pnpm install
pnpm check
pnpm dev
just e2e session-hooks
just dev-use-profile
just dev session-hooks
```

- `pnpm check` (also `just check`): runs Biome and checks that the README translations are in step, then runs the type checks, the unit tests, the builds, and the plugins' tests against DSH's own packages. `pnpm test:integration` runs dsh-chrome's tests with a real Chrome.
- `pnpm dev`: builds every plugin, installs them into a development DSH of its own (`.dsh-home`), and serves its Web UI on port 3390; run it again after a change. It runs the DSH of the DSH Desktop installed on the machine.
- `just e2e session-hooks`: runs the plugin in a real `dsh`, with a throwaway DSH home.
- `just dev-use-profile`: run once. It links `dev/local.patch.yml` to your own DSH profile's patch (read only), so the development UI reaches the same model provider.
- `just dev session-hooks`: starts a development DSH Web UI with this plugin and its example hooks on port 3091, and opens it in your browser. It uses its own DSH home and a throwaway git repository for sessions, so your own DSH and this checkout are not touched.

[AGENTS.md](AGENTS.md) holds the conventions for adding a plugin, testing, releasing, and upgrading DSH, and [docs/plugin-guidelines.md](docs/plugin-guidelines.md) what writing DSH plugins has taught this repository. Humans and coding agents follow the same rules. The READMEs of the repository and of each plugin are kept in English, Japanese, and Simplified Chinese.

## License

MIT
