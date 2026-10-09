# DeepSeek Harness plugins by langify

English | [日本語](README.ja.md) | [简体中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), published on npm under `@langify-org/dsh-*`.

| Plugin | What it does |
|---|---|
| [`@langify-org/dsh-session-hooks`](plugins/session-hooks) | Runs your shell commands when a session starts, is archived, or is restored. For example, it can give every session its own git worktree. |

Every plugin is an ordinary DSH **bundle**: an npm package whose `package.json` declares `dsh.bundle` and whose `cordis.patch.yml` inserts the plugin. The patch names the plugin by a path relative to itself (`./lib/index.js`), so the same package works with every way DSH can load it.

The plugins are experimental (0.x) while DSH itself is a release candidate. Each plugin's README has a Status section that says what it relies on.

## Install

### npm (recommended)

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

You can also install it by name from the Web UI's **Plugins** page. Then configure the plugin as its README describes.

### Tarball or checkout

```sh
dsh plugin --profile web add ./langify-org-dsh-session-hooks-0.1.0.tgz
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml
```

The first line installs a tarball made with `pnpm pack`. The second loads a built checkout directly, without installing it.

### Nix

The flake builds each plugin from source, runs its tests, and wires it to your DSH installation's own modules. Add the input to your flake. Do not make it follow your `nixpkgs`: the flake's pinned nixpkgs is the one CI tests, and another pnpm version can change the dependency hash.

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

Requirements: Node.js 24, pnpm 11, and `dsh` 0.2. `nix develop` provides Node.js, pnpm, and just.

```sh
pnpm install
just check
just e2e session-hooks
just dev-use-profile
just dev session-hooks
```

- `just check`: checks that the README translations are in step, then runs the type check, unit and integration tests, and the build.
- `just e2e session-hooks`: runs the plugin in a real `dsh`, with a throwaway DSH home.
- `just dev-use-profile`: run once. It links `dev/local.patch.yml` to your own DSH profile's patch (read only), so the development UI reaches the same model provider.
- `just dev session-hooks`: starts a development DSH Web UI with this plugin and its example hooks on port 3091, and opens it in your browser. It uses its own DSH home and a throwaway git repository for sessions, so your own DSH and this checkout are not touched.

[AGENTS.md](AGENTS.md) holds the conventions for adding a plugin, testing, releasing, and upgrading DSH. Humans and coding agents follow the same rules. Every README is kept in English, Japanese, and Simplified Chinese.

## License

MIT
