# DeepSeek Harness plugins by langify

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), published on npm under `@langify/dsh-*`.

| Plugin | What it does |
|---|---|
| [`@langify/dsh-session-hooks`](plugins/session-hooks) | Runs your shell commands when a session starts, is archived, or is restored. For example, it can give every session its own git worktree. |

Every plugin is an ordinary DSH **bundle**: an npm package whose `package.json` declares `dsh.bundle` and whose `cordis.patch.yml` inserts the plugin. The patch names the plugin by a path relative to itself (`./lib/index.js`), so the same package works with every way DSH can load it.

## Install

### npm (recommended)

```sh
dsh plugin --profile web add @langify/dsh-session-hooks
```

You can also install it by name from the Web UI's **Plugins** page. Then configure the plugin as its README describes.

### Tarball or checkout

```sh
dsh plugin --profile web add ./langify-dsh-session-hooks-0.1.0.tgz   # from `pnpm pack`
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml      # a built checkout, without installing
```

### Nix

The flake builds each plugin from source, runs its tests, and wires it to your DSH installation's own modules:

```nix
# flake inputs
inputs.dsh-plugins = {
  url = "github:langify-org/deepseek-harness-plugins";
  inputs.nixpkgs.follows = "nixpkgs";
};

# where you build the dsh command line
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
just check            # type check, unit and integration tests, build
just e2e session-hooks  # the plugin against a real dsh, in a throwaway DSH home
just dev session-hooks  # a development DSH Web UI with this plugin, on port 3091
```

[AGENTS.md](AGENTS.md) holds the conventions for adding a plugin, testing, releasing, and upgrading DSH. Humans and coding agents follow the same rules.

## License

MIT
