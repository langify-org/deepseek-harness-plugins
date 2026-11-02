# @langify-org/dsh-discord

[English](README.md) | [日本語](README.ja.md) | 中文

在 Discord 中与 DeepSeek Harness 对话。在你指定的频道中发帖，机器人会以该消息创建一个子区（thread），并为它开启一个 DSH 会话；子区就是这段对话。回复、工具审批和代理的提问都会回到子区，你用按钮作答。

## 要求

- DSH `>=0.2.1-rc.3 <0.3.0-0`，使用 Web 组合（插件使用其会话控制器）。
- 一个带机器人、只用于本插件的 Discord 应用。插件会用自己的命令替换该应用的全局斜杠命令。

## 设置 Discord

1. 在 [Developer Portal](https://discord.com/developers/applications) 创建应用并打开 **Bot**。重置令牌并保存好。开启 **Message Content Intent**：读取子区中未提及机器人的消息需要它。用户少于 10,000 人时，开启即可使用。
2. 以 `bot` 和 `applications.commands` 两个范围及以下权限邀请机器人加入服务器：View Channels、Send Messages、Send Messages in Threads、Create Public Threads、Read Message History、Add Reactions（权限整数 `309237713984`）：

   ```
   https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot+applications.commands&permissions=309237713984
   ```

3. 在 Discord 中开启 **开发者模式**（设置 → 高级），复制你的用户 ID 和要使用的每个频道的 ID。

## 安装

```sh
dsh plugin --profile <profile> add @langify-org/dsh-discord
```

在 DSH Web 或 Desktop 中，也可以在 **Plugins** 页面添加。

以 `tokenEnv` 中的名称（默认 `DISCORD_BOT_TOKEN`）把机器人令牌交给 DSH：保存为凭据，或设置在启动 DSH 的环境变量中。然后配置插件：

```yaml
- id: langify-discord
  name: '@langify-org/dsh-discord'
  config:
    userId: '123456789012345678'
    channels:
      - channelId: '234567890123456789'
        cwd: /home/me/project
```

## 配置

| 设置       | 默认值              | 含义                                                                                                     |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| `tokenEnv` | `DISCORD_BOT_TOKEN` | 保存机器人令牌的凭据名称。已保存的凭据优先于环境变量。                                                   |
| `userId`   | 空                  | 你的 Discord 用户 ID。插件只接收该用户的消息，也只有该用户能按它的按钮。必填。                           |
| `channels` | `[]`                | 新帖会开启会话的频道：`channelId`，以及会话的工作文件夹 `cwd`。若 `cwd` 有对应的 Workspace，则加入其中。 |

## 使用

- **开始对话**：在已配置的频道中发帖。机器人以你的消息创建子区，并开启名为 `discord-<子区 ID>` 的 DSH 会话。该会话也会显示在 DSH 中，两边都可以继续。
- **继续**：在子区中发帖。代理工作时，你的消息会像在 DSH 中一样进入会话的队列。
- **进度**：你的消息上出现 👀 表示已接收。代理运行期间，Discord 显示机器人正在输入。回合结束后，标记变为 ✅（完成）、⏹️（已停止）、❌（失败，错误写在子区中）、⚠️（达到输出上限）或 ⛔（被阻止）。
- **回复**：代理的每条消息都会发到子区，按 2,000 字拆分，且不破坏代码块。
- **停止**：在子区中使用 `/stop` 停止正在运行的回合。队列中的消息保留。
- **审批**：工具需要审批时，子区中会出现 **Allow** 和 **Deny**。Allow 只对这一次调用有效。
- **提问**：`ask_user_question` 的每个问题是一条消息，每个选项一个按钮（多选时为菜单），另有用于输入答案的 **Other…**。计划审阅会先显示计划。如果在你作答前问题的等待时间已过，仍可在子区或 DSH 中作答。
- **附件**：PNG、JPEG、WebP 和 GIF 图片会随消息交给模型（前提是模型接受图片）。其他文件以链接形式传递。

## 工作原理

- 机器人从 DSH 连接 Discord 的 Gateway，因此 DSH 不需要公网地址。
- 你的消息经过与 DSH Web 提示相同的会话控制器。每条消息的 ID 即请求 ID，同一消息送达两次也只会入队一次。
- ID 以 `discord-` 开头的会话会被桥接。插件把该会话的回复发到其子区，并抢在 DSH 自身的对话框之前回答其审批和提问。其他会话不受影响。
- 审批或提问到来时若无法连接 Discord，或插件在等待期间被卸载，则由 DSH 自身的对话框接手。

## 安全

任何能以 `userId` 身份在机器人可读频道中发帖的人，都能以你的 DSH 权限（包括其 shell）运行代理。请保护好该 Discord 账号（双重认证），保持服务器私密，并像对待密码一样对待机器人令牌。来自其他用户和机器人的消息会被忽略，机器人的消息从不提及任何人。另请阅读 [SECURITY.zh.md](../../SECURITY.zh.md)。

## 手动检查

这些需要 Discord 机器人，因此不在 `pnpm check` 中。用 `pnpm dev` 运行：把 `userId` 和 `channels` 写在 `package.json` 旁的 `dev.patch.yml` 中（不要提交），令牌写在 `.envrc.local` 中。

1. 在已配置频道发帖会创建子区并加上 👀，回复出现在子区中，标记变为 ✅。会话显示在 DSH 中。
2. 子区中的第二条消息继续同一会话。其他用户的消息不会得到任何反应。
3. 开启审批（`policy: ask`）时，shell 命令会显示 **Allow**/**Deny**，二者各自产生预期的工具结果。
4. 带选项、多选以及 **Other…** 的 `ask_user_question` 返回所选答案。计划审阅（`exit_plan_mode`）显示计划及其选项。
5. 在长回合中使用 `/stop` 会停止它，标记变为 ⏹️。
6. 子区中的图片能送达模型。
7. 在问题等待期间重新加载插件，问题会转到 DSH。

## 已知限制

- DSH 未运行期间发布的消息之后不会被读取。
- 只桥接机器人创建的子区；你自己创建的子区会被忽略。
- 回复按模型步骤到达；没有逐 token 的流式输出，也不显示工具调用。
- 子代理的审批和提问在 DSH 中回答。
- 反应只跟随插件运行期间开始的回合；重启后，已在进行中的回合不会得到标记。
- 非图片附件的链接过一段时间会在 Discord 端失效。
