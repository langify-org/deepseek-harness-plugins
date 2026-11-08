# DeepSeek Harness Plugins

[English](README.md) | [日本語](README.ja.md) | 中文

适用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的开源插件集，由 langify-org 维护。

## 插件

| 包                                                     | 说明                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [`@langify-org/dsh-browser`](packages/browser)         | 在右侧边栏的标签页中显示主机上的 Chromium，与模型共享，关闭页面后仍继续运行。 |
| [`@langify-org/dsh-code-server`](packages/code-server) | 在 DSH 中用 code-server 编辑会话的工作文件夹。                                |
| [`@langify-org/dsh-greet`](packages/greet)             | 注册 `greet` 工具的示例兼模板，不发布。                                       |
| [`@langify-org/dsh-side-chat`](packages/side-chat)     | 不打断对话，在右侧边栏打开的 fork 中旁路提问。                                |
| [`@langify-org/dsh-tasks`](packages/tasks)             | 在右侧边栏的任务标签页中，于终端标签页运行 justfile 的 recipe。               |
| [`@langify-org/dsh-tmux`](packages/tmux)               | 用 tmux 为每个对话提供标签页终端，与模型共享，重新加载和重启后依然保留。      |

## 安装

插件是声明了 DSH bundle 的 npm 包。使用 DSH CLI 将其添加到 profile：

```sh
dsh plugin --profile <profile> add @langify-org/dsh-<name>
```

在 DSH Web 或 Desktop 中，也可以在 **Plugins** 页面添加。各包的 README 列出了其支持的 DSH 版本。

插件在 DSH Host 进程内以当前用户的权限运行。安装前请阅读 [SECURITY.zh.md](SECURITY.zh.md)。

## 参与贡献

环境搭建、开发流程以及如何添加插件，请参阅 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 许可证

[MIT](LICENSE)
