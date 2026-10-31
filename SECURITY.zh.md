# 安全

[English](SECURITY.md) | [日本語](SECURITY.ja.md) | 中文

## 插件能做什么

DSH 插件在 DSH Host 进程内，以启动 DSH 的用户权限运行，不受 DSH 对代理工具施加的沙箱限制。请只安装你信任其源码的插件。

本仓库中的包不运行安装脚本，只包含构建产物，其源码位于本仓库中。

## 各插件的注意事项

- **[@langify-org/dsh-code-server](packages/code-server)** 在 DSH 的认证之后，从 DSH 自己的源提供 code-server；code-server 本身只监听私有的 Unix 套接字。在 code-server 中运行的代码（包括终端、扩展及其 webview）会在 DSH 沙箱之外以你的身份运行，并且由于同源，它还能以你的会话使用 DSH。请像安装 DSH 插件一样对待安装 code-server 扩展。

## 报告漏洞

请通过 [GitHub 安全公告](https://github.com/langify-org/deepseek-harness-plugins/security/advisories/new)私下报告漏洞，不要创建公开的 Issue。

请注明受影响的包及其版本、DSH 版本和复现步骤。
