# @langify-org/dsh-discord

English | [日本語](README.ja.md) | [中文](README.zh.md)

Talk to DeepSeek Harness from Discord. A message in a channel you choose opens a thread and a DSH session for it; the thread is that conversation. Replies, tool approvals and the agent's questions come back to the thread, and you answer them with buttons.

## Requirements

- DSH `>=0.2.1-rc.3 <0.3.0-0`, with the Web composition (the plugin uses its session controller).
- A Discord application with a bot, used only for this plugin. The plugin replaces the application's global slash commands with its own.

## Set up Discord

1. In the [Developer Portal](https://discord.com/developers/applications), create an application and open **Bot**. Reset the token and keep it for later. Turn on **Message Content Intent**; it is needed to read messages in threads that do not mention the bot. Below 10,000 users, turning it on is enough.
2. Invite the bot to your server with the scopes `bot` and `applications.commands` and these permissions: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Read Message History, Add Reactions (permission integer `309237713984`):

   ```
   https://discord.com/oauth2/authorize?client_id=<application id>&scope=bot+applications.commands&permissions=309237713984
   ```

3. In Discord, turn on **Developer Mode** (Settings → Advanced) and copy your user ID and the ID of each channel you want to use.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-discord
```

In DSH Web or Desktop, use the **Plugins** page instead.

Give DSH the bot token under the name in `tokenEnv` (`DISCORD_BOT_TOKEN` by default): either store it as a credential, or set it in the environment DSH starts in. Then configure the plugin:

```yaml
- id: langify-discord
  name: '@langify-org/dsh-discord'
  config:
    userId: '123456789012345678'
    channels:
      - channelId: '234567890123456789'
        cwd: /home/me/project
```

## Configuration

| Setting    | Default             | Meaning                                                                                                                            |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tokenEnv` | `DISCORD_BOT_TOKEN` | Name of the credential holding the bot token. A stored credential wins over the environment.                                       |
| `userId`   | empty               | Your Discord user ID. The plugin listens to this user only, and only this user can press its buttons. Required.                    |
| `channels` | `[]`                | Channels where a new message starts a session: `channelId`, and `cwd`, the session's working folder. A Workspace on `cwd` is used. |

## Use

- **Start a conversation**: post in a configured channel. The bot opens a thread on your message and a DSH session named `discord-<thread id>`. The session also appears in DSH, and you can continue it from either side.
- **Continue**: post in the thread. While the agent works, your message waits in the session's queue, as in DSH.
- **Progress**: 👀 on your message means it was accepted. Discord shows the bot typing while the agent runs. When the turn ends, the mark becomes ✅ (done), ⏹️ (stopped), ❌ (failed, with the error in the thread), ⚠️ (output limit) or ⛔ (blocked).
- **Replies**: each of the agent's messages is posted to the thread, split at 2,000 characters without breaking code blocks.
- **Stop**: `/stop` in the thread stops the running turn. Queued messages stay queued.
- **Approvals**: when a tool needs approval, the thread shows **Allow** and **Deny**. Allow applies to that call only.
- **Questions**: each question of `ask_user_question` is one message, with a button per option (a menu for multiple choice) and **Other…** for a typed answer. A plan review shows the plan first. If a question's wait expires before you answer, you can still answer it in the thread, or in DSH.
- **Attachments**: PNG, JPEG, WebP and GIF images go to the model with your message, if the model accepts images. Other files are passed as links.

## How it works

- The bot connects to Discord's Gateway from DSH, so DSH needs no public address.
- Your messages go through the same session controller as DSH Web's prompts. Each message's ID is its request ID, so a message delivered twice is queued once.
- A session is bridged when its ID starts with `discord-`. The plugin posts that session's replies to its thread and answers its approvals and questions ahead of DSH's own dialogs. Other sessions pass through untouched.
- If Discord cannot be reached when an approval or question arrives, or the plugin unloads while one is pending, DSH's own dialog takes it over.

## Security

Anyone who can post as `userId` in a channel the bot reads can run the agent with your DSH permissions, including its shell. Protect that Discord account (two-factor authentication), keep the server private, and treat the bot token as a password. Messages from other users and from bots are ignored, and the bot's messages never mention anyone. See also [SECURITY.md](../../SECURITY.md).

## Manual checks

These need a Discord bot, so they are not part of `pnpm check`. Run them with `pnpm dev`, putting `userId` and `channels` in a `dev.patch.yml` beside `package.json` (do not commit it), and the token in `.envrc.local`.

1. A message in a configured channel opens a thread, gets 👀, and the reply arrives in the thread; the mark becomes ✅. The session shows in DSH.
2. A second message in the thread continues the same session. A message from another user gets no reaction.
3. With approvals on (`policy: ask`), a shell command shows **Allow**/**Deny**; each gives the expected tool result.
4. `ask_user_question` with options, with multiple choice and with **Other…** returns the chosen answers. A plan review (`exit_plan_mode`) shows the plan and its options.
5. `/stop` during a long turn stops it, and the mark becomes ⏹️.
6. An image in the thread reaches the model.
7. Reloading the plugin while a question is pending moves it to DSH.

## Known limitations

- Messages posted while DSH is not running are not read later.
- Only threads the bot opened are bridged; threads you open yourself are ignored.
- Replies arrive one model step at a time; there is no token streaming, and tool calls are not shown.
- Approvals and questions from subagents are answered in DSH.
- Reactions follow turns that start while the plugin runs; after a restart, a turn already in progress gets no mark.
- Links to non-image attachments expire after a while on Discord's side.
