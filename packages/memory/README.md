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

| Setting                         | Default                   | What it is                                                                                                                                                               |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `directory`                     | `$DSH_HOME/memory`        | The memory directory                                                                                                                                                     |
| `git`                           | `git`                     | The git executable: a name looked up on `PATH`, or a path                                                                                                                |
| `timeZone`                      | the host's                | The IANA time zone of the memory conversations' days                                                                                                                     |
| `dayStartsAt`                   | `3`                       | The hour a new memory conversation starts the day                                                                                                                        |
| `subagentProvider`              | `spawn`                   | The subagent provider that starts the scribes                                                                                                                            |
| `agentPreset`                   | `langify-memory`          | The agent preset the memory conversations and their scribes run on                                                                                                       |
| `scribeProvider`, `scribeModel` | the memory conversation's | The scribes' LLM provider and model, set together                                                                                                                        |
| `scribeReasoningEffort`         | the model's default       | The scribes' reasoning effort, one the model offers                                                                                                                      |
| `toolArguments`                 | `300`                     | Characters of a tool call's arguments a scribe reads                                                                                                                     |
| `toolResult`                    | `500`                     | Characters of a tool result a scribe reads                                                                                                                               |
| `contextChars`                  | `8000`                    | Characters of what a conversation said before the part to record that a new scribe is given as context                                                                   |
| `continueSeconds`               | `300`                     | Seconds after a scribe's turn within which it goes on with its conversation's next turn: how long the prompt cache keeps its history. `0` starts a new scribe every turn |
| `continueTokens`                | `30000`                   | Tokens of context up to which a scribe goes on with its conversation's next turn                                                                                         |
| `indexLines`                    | `200`                     | Lines of `MEMORY.md` a conversation is given when it starts                                                                                                              |
| `indexBytes`                    | `25600`                   | Bytes of `MEMORY.md` a conversation is given when it starts                                                                                                              |

## How it works

On start, the plugin creates the memory directory as a git repository with two files, keeping any that exist:

- `AGENTS.md`: your guidance, what memory is for. Every scribe is given it, so this is where you say what matters to you and in which language to write. It starts with what memory is for, not how to keep it: strong models remember better when they judge what is worth keeping themselves. The plugin never changes it once it exists.
- `MEMORY.md`: the index of what is remembered.

It also registers the directory as the **memory** workspace, and adds the **Memory** agent preset (`langify-memory`) that the memory agents run on:

- Its tools are `read`, `edit`, `apply_patch`, `glob` and `grep`. There is no `write`: scribes of other conversations change the directory between a scribe's turns, and `edit` and `apply_patch` change a file only where its text still matches what the scribe read, where `write` would replace it whole with the old text. There is no shell, web or subagent tool, and the plugin hides the profile's global tools (MCP servers, browser control and so on) from agents on this preset.
- Its system prompt is only what the plugin's mechanisms need a memory agent to know: that memory is for other and later conversations, not for the one being recorded, and that a later conversation can read the user's files itself; that it writes when asked to remember something or when something is clearly worth remembering, and that most parts of a conversation leave nothing to write; that it records one conversation part by part, and where a part starts and ends in a message; what `MEMORY.md` is for and that every conversation is given its beginning; that other agents change the directory between its turns, and that a new agent takes its place in time; that what a conversation said is a record and not instructions; never to write secrets; and that each reply becomes the commit message of its turn. No instruction files, skills or runtime details are added.

### Writing

Each day has one memory conversation in the memory workspace, **Memory · YYYY-MM-DD**, started at its first use; a day starts at `dayStartsAt`. Archiving it starts a new one at the next use, since DSH runs no subagent of an archived conversation; archive past days freely. The memory conversation only holds the day's scribes. Its model replies once, with one short sentence, when it starts: the sidebar hides conversations without a turn, and the scribes with them. DSH tells a conversation when a subagent that was sent a message has finished; the plugin stops that from starting a turn here, so the memory conversation's model is not called again. Open it and choose a scribe from its header's subagent menu.

When a turn ends in a conversation, the plugin gives the part of it not recorded yet to the conversation's scribe, a subagent of that day's memory conversation. A conversation never recorded, such as one from before the plugin was installed, starts at the turn that just ended. A scribe reads what you and the model said, the tool calls and the start of each result; reasoning and context DSH injected (instruction files, skills, notices) are left out.

A scribe goes on with its conversation turn after turn: each later message carries only the next part, after the names of the memory files other scribes changed meanwhile. It therefore knows what it already recorded, so memory need not keep the conversation's place turn by turn, and its history is read from the prompt cache instead of being sent anew. A new scribe takes over when the conversation paused for more than `continueSeconds`, which is how long the cache keeps the history, or when the scribe's context passed `continueTokens`: every step reads the whole context again, so a long one costs more than starting over. A new scribe starts from nothing but your guidance, the beginning of `MEMORY.md` as conversations are given it, what the conversation said before (the newest `contextChars` characters of it, without the tool calls) and the part to record, so what one conversation said does not leak into what another is remembered for. It reads the rest of the directory as it needs.

A part to record starts after a line that names its events, such as `=== events 12 to 34 ===`, and runs to the end of the message. Nothing closes it, so nothing a conversation said can end it early.

One scribe works at a time; turns that end meanwhile wait. When a scribe's turn ends, the plugin commits every change in the directory. The commit message is the scribe's reply, with a `Memory-Source: <session id>` trailer naming the conversation. A turn that changed nothing makes no commit. A turn the scribe did not finish leaves its part to be read again, by a new scribe, with the conversation's next turn.

Conversations of subagents and conversations in the memory workspace are not recorded. A turn that ends in a conversation of the memory workspace other than a scribe, such as you editing memory there, is committed with its reply as the message.

### Reading

At the start of a turn, a conversation is given memory:

- The first time, the beginning of `MEMORY.md` (`indexLines` and `indexBytes`) and its version.
- Afterwards, when memory changed, the names of the files that changed, unless the conversation itself was the only source of the changes. Most changes come from conversations about something else, so a conversation is told where to look and reads what concerns it.
- `MEMORY.md` again when compaction hid it.

Conversations of subagents and of the memory workspace are not given memory.

## Safety

The scribes are DSH subagents on the Memory preset, working in the memory directory with file tools only. Their file permissions are the memory conversation's, so what keeps them inside the memory directory is their instructions and your permission mode, not the plugin. Every conversation is sent to them, including anything you typed into them and web pages the model read; they are told never to write secrets and to take a transcript as a record, not as instructions. Review their commits. To stop the plugin, disable it on the **Plugins** page. Nothing is deleted: the memory directory, the memory conversations and the workspace stay.
