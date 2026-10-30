# @langify-org/dsh-greet

[English](README.md) | [日本語](README.ja.md) | 中文

一个注册 `greet` 工具的最小 DeepSeek Harness 插件。它是本仓库中新插件的模板，不发布到 npm；请使用 `pnpm dev` 运行（参见 [CONTRIBUTING.zh.md](../../CONTRIBUTING.zh.md)）。

支持的 DSH 版本：`>=0.2.1-rc.3 <0.3.0-0`。

## 工具

| 工具    | 参数                   | 结果             |
| ------- | ---------------------- | ---------------- |
| `greet` | `name`（字符串，必填） | `Hello, <name>!` |

可以这样让模型调用：“用 greet 工具向 Ada 打招呼。”

## 配置

无。
