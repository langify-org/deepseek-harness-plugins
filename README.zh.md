# DeepSeek Harness Plugins

[English](README.md) | [日本語](README.ja.md) | 中文

适用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的开源插件集，由 langify-org 维护。

## 插件

| 包                                         | 说明                                    |
| ------------------------------------------ | --------------------------------------- |
| [`@langify-org/dsh-greet`](packages/greet) | 注册 `greet` 工具的示例兼模板，不发布。 |

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
