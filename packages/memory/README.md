# @langify-org/dsh-memory

English | [日本語](README.ja.md) | [中文](README.zh.md)

Gives DeepSeek Harness a memory: a directory that a scribe agent keeps up to date from every conversation. The scribe works in its own conversation in a **memory** workspace, so you can watch what it remembers and why, and every change is a git commit you can undo.

This is the first stage: memory is written, but conversations do not read it yet.

## Requirements

- DSH `>=0.2.2-rc.1 <0.3.0-0` with the Web app (it creates the scribe's conversations).
- [`git`](https://git-scm.com) on the host's `PATH`.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-memory
```

In DSH's Web and Desktop apps, add it from the **Plugins** page.

## Settings

| Setting         | Default            | What it is                                                       |
| --------------- | ------------------ | ---------------------------------------------------------------- |
| `directory`     | `$DSH_HOME/memory` | The memory directory                                             |
| `git`           | `git`              | The git executable: a name looked up on `PATH`, or a path        |
| `timeZone`      | the host's         | The IANA time zone whose days each get a new scribe conversation |
| `toolArguments` | `300`              | Characters of a tool call's arguments the scribe reads           |
| `toolResult`    | `500`              | Characters of a tool result the scribe reads                     |

## How it works

On start, the plugin creates the memory directory as a git repository with two files, keeping any that exist:

- `AGENTS.md`: what memory is for. DSH gives it to every conversation working in the directory, so this is where you tell the memory agents what matters to you. It says what memory is for, not how to keep it: strong models remember better when they judge what is worth keeping themselves.
- `MEMORY.md`: the index of what is remembered.

It also registers the directory as the **memory** workspace.

When a turn ends in a conversation, the plugin sends the part of the conversation the scribe has not read yet to that day's scribe conversation, **Memory scribe · YYYY-MM-DD** in the memory workspace, which it starts when there is none. The scribe reads what you and the model said, the tool calls and the start of each result; reasoning and context DSH injected (instruction files, skills, notices) are left out. Conversations of subagents and conversations in the memory workspace are not sent. A conversation the scribe has never read, such as one from before the plugin was installed, starts at the turn that just ended. Requests that arrive while the scribe works wait and are read together.

When a turn ends in any conversation in the memory workspace, the plugin commits every change in the directory. The commit message is the reply that ended the turn, with a `Memory-Source: <session id>` trailer for each conversation the turn read. A turn that changed nothing makes no commit.

## Safety

The scribe is an ordinary DSH conversation with the default preset and its permissions, working in the memory directory. Every conversation is sent to it, including anything you typed into them, but the `AGENTS.md` tells it never to write secrets; review its commits. To stop it, disable the plugin on the **Plugins** page. Nothing is deleted: the memory directory, the scribe's conversations and the workspace stay.
