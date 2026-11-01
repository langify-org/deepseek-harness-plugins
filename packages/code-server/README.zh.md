# @langify-org/dsh-code-server

[English](README.md) | [日本語](README.ja.md) | 中文

在 DeepSeek Harness 的右侧边栏中，用 [code-server](https://github.com/coder/code-server) 编辑会话的工作文件夹。DSH 中指向文本文件的链接会在该编辑器中的对应行打开。

## 要求

- DSH `>=0.2.1-rc.3 <0.3.0-0`，运行于 Linux 或 macOS。
- 另行安装的 code-server，已在 4.143 上验证。插件负责启动和停止它，无需你自己运行。
- 会话的文件必须位于运行 DSH 的机器上。位于其他文件系统（例如沙箱）上的会话会被拒绝。

## 安装

```sh
dsh plugin --profile <profile> add @langify-org/dsh-code-server
```

在 DSH Web 或 Desktop 中，也可以在 **Plugins** 页面添加。

## 使用

打开右侧边栏，添加标签页并选择 **Code**，即可打开会话的工作文件夹。首次启动 code-server 需要几秒钟。在 DSH 的其他位置（例如 **Workspace files** 或对话中的链接）选择文本文件时，它会显示在 Code 页面中。图片、PDF 等文件仍使用 DSH 自带的查看器。

- 编辑器已连接时，相关提示都显示在编辑器中。状态栏会显示表示连接状态的 **DSH**，点击即可选择**重新连接**或查看连接日志。无法打开的文件也会在编辑器中提示；会话的工作文件夹变化时，会弹出通知询问是否在新文件夹中重新打开编辑器。
- 从编辑器重新连接时，如有未保存的更改，会先要求保存，然后重新加载编辑器。重新连接前选择的文件不会重新打开。
- 只有在编辑器无法提示时，页面才会显示：code-server 启动中或启动失败，以及连接结束之后。连接结束后编辑器仍会保留，上方会提供**重新连接**；DSH 标签页的刷新命令也有同样的效果。
- 编辑器未能及时确认的打开请求会被报告为结果未知，并且不会重新发送，因为编辑器之后仍可能显示该文件。

## 配置

| 设置            | 默认值        | 含义                                                                                                  |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `command`       | `code-server` | 可执行文件的名称或路径。                                                                              |
| `userDataDir`   | 空            | code-server 的 `--user-data-dir`。为空时使用其默认值。                                                |
| `extensionsDir` | 空            | code-server 的 `--extensions-dir`。为空时使用其默认值。                                               |
| `desktopPort`   | `41820`       | DSH Desktop 加载编辑器所用的 `127.0.0.1` 端口。请保持固定：编辑器的状态（如受信任的文件夹）按源保存。 |

使用默认值时，编辑器会与你平时使用的 code-server 共享设置和扩展。请不要同时运行使用相同目录的另一个 code-server。

## 工作原理

- 插件在需要时为 DSH 启动一个 code-server，监听只有你能打开的 Unix 套接字（位于 `0700` 目录中，权限为 `0600`），并关闭 code-server 自身的认证。code-server 本身不会打开任何网络端口。
- 在浏览器中，DSH 在自己的源下通过 `/code-server` 提供编辑器。每个请求和 WebSocket 都会先经过 DSH 的认证和来源检查，因此只有能访问 DSH 的地方（例如通过 Tailscale）才能访问编辑器。
- DSH Desktop 在 `dsh-app://app` 显示 DSH，code-server 无法在那里运行：它根据自身页面的地址构造服务器地址，而且该协议不支持 webview 所需的 Service Worker。Desktop 还会拒绝来自其他源、发往其 Host 的 WebSocket。因此在 Desktop 中，插件自己在 `127.0.0.1:<desktopPort>` 提供编辑器，这是一个独立于 DSH 的普通 http 源。Desktop 第一次打开 Code 页面时才开始监听。编辑器地址的路径中带有一个随机令牌，插件每次启动时重新生成；code-server 的所有地址都相对于其页面，因此每个请求都会带上它。只有经过 DSH 认证的页面才能拿到该令牌。该端口还会拒绝声明为其他主机名的请求，以防 DNS rebinding。
- 每次启动前，插件都会把内置的 VS Code 扩展 **DSH Code Bridge**（`langify-org.dsh-code-bridge`）安装到 code-server 中，替换旧版本。
- 每个 Code 页面都有自己的连接（binding）。页面把 binding 放在编辑器 URL 的片段中（这一部分不会发送到服务器），该编辑器窗口中的扩展读取它，并通过另一个私有套接字连接到插件。即使多个页面打开了同一个文件夹，文件也只会在对应的窗口中打开。

## 安全

code-server 及其终端和扩展以你的身份运行，不受 DSH 沙箱和审批的约束。在浏览器中，编辑器与 DSH 同源，因此在 code-server 中运行的代码（包括扩展及其 webview）也能以你的会话使用 DSH。请只安装你信任的扩展。另请参阅 [SECURITY.zh.md](../../SECURITY.zh.md)。

## 手动检查

这些检查需要浏览器和真实的 code-server，因此不包含在 `pnpm check` 中。发布前请用 `pnpm dev` 进行检查。在 `pnpm dev` 下，[dev.patch.yml](dev.patch.yml) 会把 code-server 的设置和扩展放在 `.dsh/code-server/` 中，与你平时使用的 code-server 分开。Host 和页面的修改会在 `pnpm dev` 运行期间重新加载；而 `src/extension/` 下的修改要重启 `pnpm dev` 后才会生效，因为 code-server 只在启动时安装扩展。

1. **Code** 只显示编辑器，上方没有其他内容；编辑器状态栏中的 **DSH** 显示为已连接（受限模式下也是如此）。连接结束后编辑器仍会保留，上方的一行会提供**重新连接**。
2. 在 **Workspace files** 中选择的文本文件会在 Code 页面的对应行打开；图片仍使用 DSH 的查看器。
3. 未登录时，`/code-server/` 和 `POST /api/langify-code-server/create` 返回 401，来自其他源的 WebSocket upgrade 返回 403。
4. 会话的工作文件夹变化后，编辑器会询问是否重新打开；如有未保存的文件，会先要求保存，然后页面在新文件夹中重新打开编辑器。
5. 在 DSH Desktop 中，编辑器从 `http://127.0.0.1:41820/…` 加载，显示你的主题和文件图标，Markdown 预览可以打开；没有令牌时该端口返回 404。
6. 关闭 Code 标签页会关闭其 binding；停止 DSH 会停止 code-server 并删除其套接字。

## 已知限制

- DSH 没有在文件标签页打开之前进行拦截的机制，因此在切换到 Code 页面之前，文件标签页会短暂出现。
- 传递 binding 依赖于 code-server 在响应 `vscode.env.asExternalUri` 时保留页面 URL 的片段。这是 code-server 的行为，而不是有文档保证的承诺；更新 code-server 后请重新检查。
