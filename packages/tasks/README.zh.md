# @langify-org/dsh-tasks

[English](README.md) | [日本語](README.ja.md) | 中文

在 DeepSeek Harness 右侧边栏的 **任务** 标签页中运行 [justfile](https://just.systems) 的 recipe。每个 recipe 都有一个运行按钮，命令在 DSH 自带终端的新标签页中运行。

## 要求

- 带 Web UI 的 DSH `>=0.2.2-rc.1 <0.3.0-0`。
- 主机 `PATH` 中的 [`just`](https://just.systems)。参数说明、选项和标志来自 `[arg(...)]` 属性，较新的 `just` 版本支持该属性；使用旧版本时只列出 recipe，不带这些信息。

## 安装

```sh
dsh plugin --profile <profile> add @langify-org/dsh-tasks
```

在 DSH Web 和 Desktop 中，也可以从 **Plugins** 页面添加。

## 设置

| 设置    | 默认值     | 含义                                                                                                                       |
| ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `runIn` | `terminal` | recipe 运行的位置：`terminal` 为新的终端标签页；`tmux` 为对话 tmux 会话中的新窗口（需要 [@langify-org/dsh-tmux](../tmux)） |

## 使用

从右侧边栏的引导中打开 **任务**。它列出 `just` 从会话工作目录（或其上级目录）找到的 justfile 中的公开 recipe，并显示各自的 doc 注释和以 `just` 写法表示的参数（`target mode=debug [--verbose] *rest`）。

- 点击 recipe 即可运行：会打开一个新的终端标签页并输入 `just <recipe>`。在该终端中按 Ctrl-C 可以停止。
- **在 tmux 中运行**：设置为 `runIn: tmux` 且 tmux 插件正在运行时，recipe 改为在对话 tmux 会话的新窗口中运行，并打开显示该窗口的 **tmux** 标签页。没有 tmux 插件时，recipe 在终端标签页中运行。
- 点击带参数的 recipe 时，会先在该行下方展开参数。字面量默认值会预先填好，标志是复选框，可变参数（`*rest`、`+rest`）用空格分隔多个值；悬停可查看参数说明。回车运行，Esc 关闭。值的检查（包括 `pattern`）由 `just` 完成。
- 每次回到窗口时，列表都会重新读取 justfile。justfile 位于会话目录的上级时，会在列表下方注明其位置。

以 `_` 开头或标记为 `[private]` 的 recipe，以及 `mod` 子模块中的 recipe，不会列出。在终端标签页中的运行不会告知模型，其输出也不会进入模型历史。在 tmux 中的运行与其他 tmux 窗口一样：模型会在下一轮开始时得知并可以读取它。

## 安全

点击运行等同于自己输入 `just <recipe>`：它以你的用户权限、在 agent 沙箱之外运行，命令会显示在终端中。列出 recipe 不会运行 justfile 中的任何代码。表单的值会输入到交互式 shell 中，因此每个值都用单引号括起来；含有控制字符的值（终端即使在引号内也会响应）会被拒绝。

## 工作原理

主机插件在会话的工作目录中运行 `just --dump --dump-format json` 并返回 recipe。设置为 `runIn: tmux` 时，主机改为在运行时用 `ctx.get` 找到 tmux 插件的 `langifyTmux` 服务并交给它命令行（两个包互不 import），浏览器打开该服务返回的标签页类型。否则浏览器部分通过右侧边栏的 `openTab('terminal')` 打开终端标签页，从 `ctx.webTerminals` 取得该标签页的终端模型，等待其连接并可写后，写入命令行和回车。

## 已知限制

- **依赖未公开的终端接口**：`ctx.webTerminals` 是终端标签页自身的服务，并非公开的插件 API，DSH 更新后运行功能可能失效。
- **仅文本输入框**：`debug|release` 这样的 `pattern` 尚未作为选项提供。

## 在浏览器中验证

在仓库根目录运行 `pnpm dev`，然后在目录中有 justfile 的会话中：

1. 从右侧边栏的引导中打开 **任务**。显示 recipe 及其参数。
2. 点击无参数的 recipe。终端标签页打开并运行 `just <recipe>`。
3. 在带参数的 recipe 的表单中输入 `a b; echo hi` 之类的值并运行。recipe 原样收到该值，`echo hi` 不会运行。
4. 运行一个耗时的 recipe，并在终端中按 Ctrl-C 停止。
