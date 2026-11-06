# @langify-org/dsh-side-chat

English | [日本語](README.ja.md) | [中文](README.zh.md)

Ask a side question about a DeepSeek Harness conversation without interrupting it. The side chat is a fork of the conversation, opened in the right sidebar with DSH's own chat and composer, and told that it is a side chat.

## Requirements

- DSH `>=0.2.1-rc.5 <0.3.0-0` with the Web UI.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-side-chat
```

In DSH Web and Desktop you can also add it from the **Plugins** page.

## Usage

Click the side-chat button in an assistant message's action row, or **Side chat** in the right sidebar's guide. The conversation is forked, titled `Side chat: <conversation title>`, and opens in the right sidebar, where you talk to it as in any conversation. Selecting a side chat in the session list opens its source conversation with the side chat beside it.

- The side chat starts from the conversation's latest completed turn, whichever message you clicked. Later turns of the main conversation do not reach it, and nothing in the side chat reaches the main conversation.
- The model is told it is in a side chat: to answer questions rather than resume the main task, and not to make changes unless you ask in the side chat. You do not see this instruction in the chat.

## How it works

The host plugin forks the session through DSH's session controller, the same fork as the **Fork** action, and puts the side-chat instruction into the fork's inbox at once with `agent.inject`; it reaches the model with the first message. The inbox is logged as soon as it changes, so the fork is marked as a side chat from its creation, across restarts. A session projection, `langifySideChat`, folds that mark from the fork's own log and reaches every browser with the session list. The browser half opens the fork in its own right-sidebar tab, which renders DSH's shared `conversation.content` with the Chat view, embedded as DSH's subagent tab embeds it. The fork is an ordinary session, so messages go through the ordinary prompt path.

## Known limitations

- **Listed in the sidebar**: a side chat is an ordinary session, so it appears in the session list. Archive it when you are done.
- **Latest turn only**: the side chat starts from the latest completed turn; it cannot yet start from an earlier message.

## Verifying in a browser

`pnpm dev` from the repository root, then in a conversation with at least one completed turn:

1. Click the side-chat button under an assistant message. A **Side chat** tab opens in the right sidebar with an empty composer.
2. Send a question about the conversation. It answers with the conversation's context.
3. Check that the main conversation shows nothing new.
4. Check that the side-chat instruction is not shown in the side chat, and that it appears in the fork's Trajectory view.
