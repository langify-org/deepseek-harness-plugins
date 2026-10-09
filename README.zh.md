# DeepSeek Harness plugins by langify

[English](README.md) | [日本語](README.ja.md) | 简体中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件集，以 `@langify-org/dsh-*` 发布在 npm 上。

| 插件 | 功能 |
|---|---|
| [`@langify-org/dsh-session-hooks`](plugins/session-hooks/README.zh.md) | 在会话开始、归档或取消归档时运行你指定的 shell 命令。例如，可以为每个会话准备独立的 git worktree。 |

每个插件都是普通的 DSH **组合包**（bundle）：在 `package.json` 中声明 `dsh.bundle` 的 npm 包，由随包附带的 `cordis.patch.yml` 插入插件。patch 以相对于自身的路径（`./lib/index.js`）指定插件，因此无论 DSH 以哪种方式加载，同一个包都能直接使用。

由于 DSH 本身仍是候选发布版，所有插件都处于实验阶段（0.x）。各插件 README 的“状态”一节说明了它依赖哪些机制。

## 安装

### npm（推荐）

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

也可以在 Web UI 侧边栏的**插件**页中按包名安装。安装后，请按各插件的 README 进行配置。

### 从 tarball 或源码检出安装

```sh
dsh plugin --profile web add ./langify-org-dsh-session-hooks-0.1.0.tgz
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml
```

第一行安装由 `pnpm pack` 生成的 tarball；第二行不经安装，直接加载已构建的源码检出。

### Nix

flake 会从源码构建每个插件、运行其测试，并把它与你所用 DSH 安装自带的模块连接起来。先把它加入 flake 的 inputs。不要让它 follows 你自己的 `nixpkgs`：CI 测试的是 flake 自身固定的 nixpkgs，换用其他版本的 pnpm 可能导致依赖哈希不一致。

```nix
inputs.dsh-plugins.url = "github:langify-org/deepseek-harness-plugins";
```

再在组装 `dsh` 命令行的位置传入插件的 patch：

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

不传 `dshNodeModules`、只写 `mkPlugins { inherit pkgs; }` 时，得到的是尚未与 DSH 连接的普通构建，与 `packages.<system>.<plugin>` 相同。

## 开发

环境要求：Node.js 24、pnpm 11 和 `dsh` 0.2。`nix develop` 提供 Node.js、pnpm 和 just。

```sh
pnpm install
just check
just e2e session-hooks
just dev-use-profile
just dev session-hooks
```

- `just check`：先检查 README 各语言版本是否同步，再运行类型检查、单元测试与集成测试以及构建。
- `just e2e session-hooks`：在一次性的 DSH home 中，用真实的 `dsh` 运行该插件。
- `just dev-use-profile`：只需运行一次。它把 `dev/local.patch.yml` 链接到你自己 DSH profile 的 patch（只读），让开发用 UI 连接同样的模型提供方。
- `just dev session-hooks`：在 3091 端口启动装有该插件及示例钩子的开发用 DSH Web UI，并在浏览器中打开。它使用独立的 DSH home 和供会话使用的一次性 git 仓库，因此不会影响你平时的 DSH 和本仓库。

添加插件、测试、发布以及升级 DSH 的约定见 [AGENTS.md](AGENTS.md)（英文）。人和编程智能体遵循同一套约定。所有 README 都以英文、日文和简体中文三种语言维护。

## 许可证

MIT
