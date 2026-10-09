# @langify-org/dsh-session-hooks

[English](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.md) | [日本語](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.ja.md) | 简体中文

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的会话开始、被归档或被取消归档时，运行你自己的 shell 命令。典型用途：为每个会话准备独立的 git worktree、准备或清理资源，以及与外部任务跟踪工具保持同步。命令来自你的 DSH 配置，或来自受信任项目自己的 `.dsh/hooks.yml`。

| 事件 | 运行时机 | 命令可以做什么 |
|---|---|---|
| `sessionStart` | 新会话创建时（在第一次模型请求之前） | 做准备工作；还可以输出 `{"workdir": ..., "context": ...}`，为会话指定工作目录并告知模型 |
| `sessionArchive` | 会话被归档之后 | 清理或转存资源 |
| `sessionUnarchive` | 已归档的会话被取消归档之后 | 恢复资源 |

需要 DSH `0.2.x` 和 POSIX shell（Linux 或 macOS）。

## 状态

**实验性插件。** 在 1.0 之前，配置项以及命令接收的信息可能会在次版本更新中发生变化；发生变化时会写入更新日志（CHANGELOG）。

- 以 DSH `0.2.0-rc.2` 为目标，在 Linux 上构建和测试。macOS 应该可以使用，但尚未验证。不支持 Windows。
- 归档和取消归档时的钩子依赖 DSH 的内部机制。DSH 没有归档事件，因此插件监视工作区注册表所保存的已归档会话列表（见“工作原理”）。DSH 更新后这一机制可能改变，届时归档钩子会在不报错的情况下停止运行。本仓库的端到端测试会针对目标 DSH 版本检查这一行为。
- 开始时命令返回的 `workdir` 只是给模型的提示，并不会真正改变会话的目录（见“让会话在其他目录中工作”）。

## 安装

**通过 npm**（适用于任何 DSH 安装）：

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

也可以在 Web UI 侧边栏的**插件**页中按包名安装。安装过程中 pnpm 会提示 `Issues with peer dependencies found`，这是正常的：`@deepseek-ai/*` 这些 peer 依赖由 DSH 自身提供。

**通过 `--patch` 加载**（不修改 profile；Nix 环境使用这种方式）：把组合包自带的 patch 文件传给 `dsh`。其中的插件路径相对于该文件，因此无论是解压后的包还是源码检出都能直接使用：

```sh
dsh web --patch /path/to/dsh-session-hooks/cordis.patch.yml --patch ./my-hooks.patch.yml
```

以这种方式加载时，插件必须能通过 Node 的常规查找找到 DSH 自身的 `@deepseek-ai/*` 模块。本仓库的 Nix flake（`lib.mkPlugins`）会自动处理，详见[仓库 README](https://github.com/langify-org/deepseek-harness-plugins/blob/main/README.zh.md#nix)。

安装后不会运行任何东西，配置钩子之后才会生效。

## 配置

在 profile 的 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）或之后加载的 `--patch` 文件中添加下面这一行。它会替换插件的整个 `config`，因此请写出你用到的所有键：

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - ~/.config/dsh/hooks/start.sh
    sessionArchive:
      - command: ~/.config/dsh/hooks/archive.sh
        timeoutMs: 120000
    sessionUnarchive:
      - ~/.config/dsh/hooks/unarchive.sh
```

在默认的 `web` profile 中，保存 profile 的 `cordis.patch.yml` 后改动会立即生效。未启用 HMR 的 profile，以及修改 `--patch` 文件时，需要重启 DSH。

| 键 | 默认值 | 含义 |
|---|---|---|
| `sessionStart`、`sessionArchive`、`sessionUnarchive` | `[]` | 各事件要运行的命令：字符串，或 `{ command, timeoutMs }`。按顺序逐个运行。 |
| `startSources` | `[startup]` | 哪些类型的会话开始会运行 `sessionStart`：`startup`（新会话）、`resume`、`clear`、`compact`。 |
| `includeSubagents` | `false` | 也为 subagent 和队友（teammate）的会话运行钩子。 |
| `defaultTimeoutMs` | `60000` | 未设置 `timeoutMs` 的命令的超时时间（毫秒）。 |
| `shell` | `bash` | 命令以 `<shell> -c <command>` 的形式运行。 |
| `projectHooks.trustedDirs` | `[]` | 允许其中的项目运行自己钩子文件的目录（可用 `~/`）。为空时项目钩子关闭。 |
| `projectHooks.file` | `.dsh/hooks.yml` | 项目钩子文件的位置（相对于项目根目录）。 |
| `stateDir` | `$DSH_HOME/langify-session-hooks` | 每个会话的记录和 `hooks.log` 的存放位置。 |

## 项目钩子

项目可以在根目录的 `.dsh/hooks.yml` 中定义自己的钩子，与它要运行的脚本放在同一个仓库里。可以像 GitHub Actions 工作流那样直接内联编写脚本：

```yaml
sessionStart:
  - |
    pnpm install --frozen-lockfile >&2
    echo '{"context": "Dependencies are installed; use pnpm."}'
sessionArchive:
  - ./scripts/cleanup.sh
  - command: ./scripts/backup.sh
    timeoutMs: 300000
```

- 该文件使用与插件配置相同的三个列表，其中命令接收和输出的内容也与配置中的命令相同（见后面几节）。
- 项目根目录是会话目录所属的 git 工作树；不在 git 中时就是会话目录本身。项目命令在根目录中运行，因此 `./scripts/cleanup.sh` 这样的相对路径从根目录解析。
- 项目命令在配置中的命令之后运行，并收到前者选定的 `workdir`。
- 每次事件都会重新读取该文件，因此修改无需重启即可生效。

项目钩子只会在你信任的项目中运行。在插件配置中列出这些目录；只有根目录位于其中之一的项目才会运行自己的文件：

```yaml
- id: langify-session-hooks
  config:
    projectHooks:
      trustedDirs:
        - ~/Projects/my-org
```

在不受信任的项目中，钩子文件里的内容一概不会运行，DSH 的 stderr 会提示一次该文件已被跳过。

## 命令接收的信息

配置中的命令在会话的目录中运行（若该目录已不存在，则在 DSH 自身的目录中运行），项目命令在项目根目录中运行。两者都通过 stdin 接收一行 JSON：

```json
{"hook_event_name":"SessionStart","session_id":"session-…","cwd":"/home/me/project","workdir":null,"source":"startup"}
```

| 字段 | 含义 |
|---|---|
| `hook_event_name` | `SessionStart`、`SessionArchive` 或 `SessionUnarchive` |
| `session_id` | DSH 会话 ID |
| `cwd` | 会话创建时所在的目录 |
| `workdir` | 开始时的命令指定的目录（见下文），没有则为 `null`。归档和取消归档时的命令会收到开始时记录的值，即使 DSH 重启过也一样。 |
| `source` | 仅 `SessionStart`：`startup`、`resume`、`clear` 或 `compact` |
| `parent_session_id`、`origin` | 分叉（fork）出的会话，以及 subagent（`origin: "subagent"`）会带有这些字段 |

同样的信息也会放进环境变量：`DSH_HOOK_EVENT`、`DSH_SESSION_ID`、`DSH_SESSION_CWD`、`DSH_SESSION_WORKDIR` 和 `DSH_HOOK_SOURCE`，并继承 DSH 自身的环境变量。含义相同的字段沿用 Claude Code 钩子 payload 的字段名。

## 让会话在其他目录中工作

DSH 在创建会话时就固定了它的目录，钩子无法修改。作为替代，`sessionStart` 的命令可以输出一个 JSON 对象，可以是全部输出，也可以是最后一行：

```json
{"workdir": "/home/me/.local/share/dsh-worktrees/project/session-…", "context": "Branch dsh/session-… was created for you."}
```

- `workdir` 必须是已存在的目录。插件会告诉模型在那里工作（在该目录中运行命令、编辑其下的文件），并把它传给后续的开始时命令，以及该会话归档和取消归档时的命令。
- `context` 是给模型的额外文本。

插件会在会话的第一次模型请求之前，把这些内容作为一条提示添加进去，并记录下来。当会话在不运行开始时命令的情况下再次开始（默认是 DSH 重启后恢复、清空或压缩时），且历史中已没有这条提示时，插件会重新发送记录的提示。Web UI 的文件面板以及会话在侧边栏中的归属，仍然以原来的目录为准。

## 示例：每个会话一个 git worktree

[`examples/`](https://github.com/langify-org/deepseek-harness-plugins/tree/main/plugins/session-hooks/examples) 中有三个配合使用的脚本：

- [`worktree-start.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-start.sh)：当会话在 git 仓库内打开时，在新分支 `dsh/<会话 ID>` 上创建 worktree，并将其作为 `workdir` 输出。
- [`worktree-archive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-archive.sh)：归档时，如果没有未提交的更改，就删除该 worktree。分支会保留。
- [`worktree-unarchive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-unarchive.sh)：取消归档时，从该分支重新创建 worktree。

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - bash /path/to/dsh-session-hooks/examples/worktree-start.sh
    sessionArchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-archive.sh
    sessionUnarchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-unarchive.sh
```

通过 `dsh plugin add` 安装后，脚本位于 `$DSH_HOME/profiles/<profile>/node_modules/@langify-org/dsh-session-hooks/examples/`。包管理器不会保留它们的可执行权限，所以请像上面那样用 `bash` 运行，或者复制到你自己的位置再修改使用。worktree 创建在 `$DSH_WORKTREES_DIR`（默认 `~/.local/share/dsh-worktrees`）中。本仓库的端到端测试正是用真实的 DSH 运行这几个脚本。

## 失败与日志

- 以非零状态退出、超时或无法启动的命令会被报告，DSH 照常运行。失败的开始时命令不会提供 `workdir` 或 `context`，下一个命令仍会运行。
- 每次运行都会以 JSON Lines 追加到 `<stateDir>/hooks.log`：事件、会话、结果、退出码、耗时，以及 stdout 和 stderr 的末尾部分。失败也会以 `[langify-session-hooks] …` 的形式输出到 DSH 的 stderr，可以在终端或服务日志中看到。
- `sessionStart` 的命令结束之前，会话的创建会一直等待。请让命令尽快完成，并为耗时的命令设置 `timeoutMs`。
- DSH 停止或重新加载插件时，正在运行的命令会被停止（先发送 SIGTERM，3 秒后发送 SIGKILL）。请把归档脚本写成重复运行也安全的形式。
- 命令退出后仍在运行的后台进程既不会被等待，也不会被停止。请重定向它们的输出，例如 `nohup task >/dev/null 2>&1 &`。

## 安全

命令以 DSH 进程自身的权限、在 agent 沙箱之外运行，与 Claude Code 的钩子相同。命令来自你的 patch 层；只有当项目位于 `projectHooks.trustedDirs` 所列目录之内时，才会读取该项目的 `.dsh/hooks.yml`。在从别处克隆来的仓库中打开会话，只要它不在受信任的目录之下，就不会运行其中的任何代码。因此只信任内容由你自己掌控的目录。

## 工作原理

- **开始：** DSH 创建会话时会发出 `agent/created`。插件在这个监听器中等待命令完成，因此命令会在第一次请求之前结束；随后通过 `agent.inject()` 添加一条 `notice` 形式的提示。
- **归档与取消归档：** DSH 没有归档事件。工作区注册表把已归档会话的集合保存在存储中，每次持久写入都会携带新集合发出 `domain/changed`。插件对比前后两次的集合。插件启动之前就已归档的会话不会触发钩子。
- 同一会话的钩子按顺序运行，不同会话的钩子并行运行。

## 许可证

MIT
