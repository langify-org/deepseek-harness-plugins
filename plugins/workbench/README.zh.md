# @langify-org/dsh-workbench

[English](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.md) | [日本語](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.ja.md) | 简体中文

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）中，在开始对话之前创建一个有名字的工作场所：它是一个注册为独立工作区的 git worktree，打开时空白会话和右侧边栏的终端都已就绪。工作完成后可以将其删除。

## 状态

原型阶段。尚未发布到 npm，行为和配置都会变化。设计以及原型中的发现见 [DESIGN.md](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/DESIGN.md)（英文）。

## 试用

在本仓库的检出目录中，启动加载了该插件的开发用 DSH。它不会影响你自己的 DSH，工作场所创建在 `.dsh-dev/workbenches/` 下。

```sh
just dev-use-profile
just dev workbench
```

在会话中打开右侧边栏，在开始页选择 **Workbench**，输入名字后点击 **Create & open**。
