# @langify-org/dsh-workbench

English | [日本語](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.ja.md) | [简体中文](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.zh.md)

Make a named place to work in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) before any conversation starts: a git worktree registered as its own Workspace, with a blank Session and a terminal ready in the right sidebar. Remove it when the work is done.

## Status

Prototype. It is not published to npm, and its behavior and configuration will change. The design and what the prototype taught are in [DESIGN.md](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/DESIGN.md) (English).

## Try it

From a checkout of this repository, start a development DSH with the plugin. It does not touch your own DSH, and workbenches go under `.dsh-dev/workbenches/`.

```sh
just dev-use-profile
just dev workbench
```

In a Session, open the right sidebar, pick **Workbench** on its Start page, enter a name, and press **Create & open**.
