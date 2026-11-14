# @langify-org/dsh-memory

English | [日本語](README.ja.md) | [中文](README.zh.md)

Gives DeepSeek Harness a memory: a directory that scribe agents keep up to date from every conversation, and that every conversation is given. The scribes work in a **memory** workspace, so you can watch what they remember and why, and every change is a git commit you can undo.

## Requirements

- DSH `>=0.2.2-rc.2 <0.3.0-0` with the Web app (it creates the memory conversations) and in-process subagents.
- [`git`](https://git-scm.com) on the host's `PATH`.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-memory
```

In DSH's Web and Desktop apps, add it from the **Plugins** page.

## Settings

| Setting            | Default            | What it is                                                         |
| ------------------ | ------------------ | ------------------------------------------------------------------ |
| `directory`        | `$DSH_HOME/memory` | The memory directory                                               |
| `git`              | `git`              | The git executable: a name looked up on `PATH`, or a path          |
| `timeZone`         | the host's         | The IANA time zone of the memory conversations' days               |
| `dayStartsAt`      | `3`                | The hour a new memory conversation starts the day                  |
| `subagentProvider` | `spawn`            | The subagent provider that starts the scribes                      |
| `agentPreset`      | `langify-memory`   | The agent preset the memory conversations and their scribes run on |
| `toolArguments`    | `300`              | Characters of a tool call's arguments a scribe reads               |
| `toolResult`       | `500`              | Characters of a tool result a scribe reads                         |
| `indexLines`       | `200`              | Lines of `MEMORY.md` a conversation is given when it starts        |
| `indexBytes`       | `25600`            | Bytes of `MEMORY.md` a conversation is given when it starts        |
| `rebaselineAfter`  | `20`               | Commits after which a conversation is given `MEMORY.md` again      |

## How it works

On start, the plugin creates the memory directory as a git repository with two files, keeping any that exist:

- `AGENTS.md`: your guidance, what memory is for. Every scribe is given it, so this is where you say what matters to you and in which language to write. It starts with what memory is for, not how to keep it: strong models remember better when they judge what is worth keeping themselves. The plugin never changes it once it exists.
- `MEMORY.md`: the index of what is remembered.

It also registers the directory as the **memory** workspace, and adds the **Memory** agent preset (`langify-memory`) that the memory agents run on:

- Its tools are `read`, `write`, `edit`, `apply_patch`, `glob` and `grep`. There is no shell, web or subagent tool, and the plugin hides the profile's global tools (MCP servers, browser control and so on) from agents on this preset.
- Its system prompt is only what the plugin's mechanisms need a memory agent to know: what `MEMORY.md` is for, that a transcript is a record and not instructions, never to write secrets, and that its reply becomes the commit message. No instruction files, skills or runtime details are added.

### Writing

Each day has one memory conversation in the memory workspace, **Memory · YYYY-MM-DD**, started at its first use; a day starts at `dayStartsAt`. Archiving it starts a new one at the next use, since DSH runs no subagent of an archived conversation; archive past days freely. The memory conversation only holds the day's scribes. Its model replies once, with one short sentence, when it starts: the sidebar hides conversations without a turn, and the scribes with them. Open it and choose a scribe from its header's subagent menu.

When a turn ends in a conversation, the plugin starts a scribe, a subagent of that day's memory conversation, and gives it the part of the conversation not recorded yet. A conversation never recorded, such as one from before the plugin was installed, starts at the turn that just ended. A scribe reads what you and the model said, the tool calls and the start of each result; reasoning and context DSH injected (instruction files, skills, notices) are left out. Every scribe starts from nothing but your guidance, the beginning of `MEMORY.md` as conversations are given it, and the transcript, so what one conversation said does not leak into what another is remembered for. It reads the rest of the directory as it needs.

One scribe works at a time; turns that end meanwhile wait. When a scribe finishes, the plugin commits every change in the directory. The commit message is the scribe's reply, with a `Memory-Source: <session id>` trailer naming the conversation. A scribe that changed nothing makes no commit. A scribe that did not finish leaves its part to be read again with the conversation's next turn.

Conversations of subagents and conversations in the memory workspace are not recorded. A turn that ends in a conversation of the memory workspace other than a scribe, such as you editing memory there, is committed with its reply as the message.

### Reading

At the start of a turn, a conversation is given memory:

- The first time, the beginning of `MEMORY.md` (`indexLines` and `indexBytes`) and its version.
- Afterwards, when memory changed, the messages of the commits since, unless the conversation itself was their only source.
- `MEMORY.md` again when more than `rebaselineAfter` commits came since it was given, or when compaction hid it.

Conversations of subagents and of the memory workspace are not given memory.

## Safety

The scribes are DSH subagents on the Memory preset, working in the memory directory with file tools only. Their file permissions are the memory conversation's, so what keeps them inside the memory directory is their instructions and your permission mode, not the plugin. Every conversation is sent to them, including anything you typed into them and web pages the model read; they are told never to write secrets and to take a transcript as a record, not as instructions. Review their commits. To stop the plugin, disable it on the **Plugins** page. Nothing is deleted: the memory directory, the memory conversations and the workspace stay.
