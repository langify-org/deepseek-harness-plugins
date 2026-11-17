# @langify-org/dsh-memory

English | [日本語](README.ja.md) | [中文](README.zh.md)

Gives DeepSeek Harness a memory built the way people's is: what happened is noted as it happens and never rewritten, what is known is made from it overnight, and what is known comes to mind when something said calls for it. The memory is a directory of Markdown notes in git, kept by agents in a **memory** workspace, so you can read it, watch it being kept, and undo any change.

Why it is built this way, what was measured, and what was tried and left out: [DESIGN.md](DESIGN.md).

## Requirements

- DSH `>=0.2.2-rc.2 <0.3.0-0` with the Web app (it creates the memory conversations) and in-process subagents.
- [`git`](https://git-scm.com) on the host's `PATH`.

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-memory
```

In DSH's Web and Desktop apps, add it from the **Plugins** page.

## Settings

| Setting                           | Default                                        | What it is                                                                                                                             |
| --------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `directory`                       | `$DSH_HOME/memory`                             | The memory directory                                                                                                                   |
| `git`                             | `git`                                          | The git executable: a name looked up on `PATH`, or a path                                                                              |
| `timeZone`                        | the host's                                     | The IANA time zone of the memory conversations' days                                                                                   |
| `dayStartsAt`                     | `3`                                            | The hour a new memory conversation starts the day                                                                                      |
| `subagentProvider`                | `spawn`                                        | The subagent provider that starts the scribes                                                                                          |
| `agentPreset`                     | `langify-memory`                               | The agent preset the memory conversations and their scribes run on                                                                     |
| `scribeProvider`, `scribeModel`   | the memory conversation's                      | The scribes' LLM provider and model, set together                                                                                      |
| `scribeReasoningEffort`           | the model's default                            | The scribes' reasoning effort, one the model offers                                                                                    |
| `tidyProvider`, `tidyModel`       | the default model when the day starts          | The LLM provider and model that bring what is known up to date, set together                                                           |
| `tidyReasoningEffort`             | the model's default                            | Their reasoning effort, one the model offers                                                                                           |
| `watcherProvider`, `watcherModel` | none: no hunch is brought up                   | The LLM provider and model of the small model that watches conversations and brings up hunches, set together                           |
| `watcherReasoningEffort`          | the model's default                            | Its reasoning effort, one the model offers                                                                                             |
| `toolArguments`                   | `300`                                          | Characters of a tool call's arguments a scribe reads                                                                                   |
| `toolResult`                      | `500`                                          | Characters of a tool result a scribe reads                                                                                             |
| `contextChars`                    | `8000`                                         | Characters of what a conversation said before the part to record that a new scribe is given as context                                 |
| `continueTokens`                  | `200000`                                       | Tokens of context past which a conversation's scribe is replaced by a new one: a guard against a runaway scribe, not a setting to tune |
| `transcripts`                     | the memory directory with `-transcripts` added | The directory where what the scribes were given of the conversations is kept, as plain text, to check notes against                    |
| `transcriptDays`                  | `7`                                            | Days for which what the scribes were given is kept                                                                                     |
| `episodeDays`                     | `30`                                           | Days for which episodes stay in the directory; git keeps them longer                                                                   |
| `indexLines`                      | `200`                                          | Lines of `MEMORY.md` a conversation is given when it starts                                                                            |
| `indexBytes`                      | `25600`                                        | Bytes of `MEMORY.md` a conversation is given when it starts                                                                            |

## How it works

On start, the plugin creates the memory directory as a git repository, keeping whatever is there:

- `AGENTS.md`: your guidance, what memory is for. Every memory agent is given it, so this is where you say what matters to you and in which language to write. It starts with what memory is for, not how to keep it: strong models remember better when they judge what is worth keeping themselves. The plugin never changes it once it exists.
- `MEMORY.md` and the files it points to: **what is known**, by subject. `MEMORY.md` is the index.
- `episodes/<day>/<conversation>.md`: **the record**. What a scribe noted of one conversation on one day, entry by entry, each under a heading that gives the time and the events it is about; headings in an entry itself are moved two levels down. The plugin appends to these files and nothing rewrites them.
- `hunches/`: what earlier conversations taught about **how to act in a kind of moment**, a file for each: the cues by which the moment can be told as it happens, what happened in it, your words, and why it may matter. The nightly agent writes them. Conversations are not given them to read; a watcher brings one up when its moment comes (see Reading).
- `questions.md`: what memory cannot settle without you, with what was said and where. The nightly agent writes it. Nothing in the plugin asks you; a scheduled task of yours can.

It also registers the directory as the **memory** workspace, and adds the **Memory** agent preset (`langify-memory`) that the memory agents run on. Its tools are `read`, `edit`, `apply_patch`, `glob` and `grep`, and scribes are left only the three that read: there is no shell, web or subagent tool, and the plugin hides the profile's global tools (MCP servers, browser control and so on) from agents on this preset. Its system prompt holds what every memory agent needs to know of the mechanisms; what one agent is there to do is the beginning of its first message. No instruction files, skills or runtime details are added.

### Noting

Each day has one memory conversation in the memory workspace, **Memory · YYYY-MM-DD**, which holds the day's scribes. It starts when the day does, at `dayStartsAt`, or at its first use when DSH was not running then. Archiving it starts a new one at the next use, since DSH runs no subagent of an archived conversation; archive past days freely. Open it and choose a scribe from its header's subagent menu.

When a turn ends in a conversation, the plugin gives the part of it not read yet to the conversation's scribe. A scribe reads what you and the model said, what subagents sent back (whole, with the child's session id), the tool calls and the start of each result; reasoning and context DSH injected (instruction files, skills, notices) are left out, except which hunches memory brought up, by name. Its reply is the part's entry: what was decided and why, what was learned and how it is known, what was promised and for which date, what changed and from what, and where you corrected the model, passed over what it offered or were pleased by what it did, what it had done and your words; and where memory brought up a hunch, whether it fitted and what came of it. The plugin appends the entry to the conversation's file of episodes and commits it, with a `Memory-Source: <session id>` trailer. A part that holds nothing of the kind gets the reply `(nothing)` and no entry. A scribe writes no file, so it can neither reorganize what is known nor overwrite it, and it takes one model call a turn.

A conversation keeps one scribe for the day, so the scribe knows what it already noted and its history is read from the prompt cache. A scribe that is new to a conversation nearly always notes something on its first turn, wanted or not, so the plugin avoids handovers: a scribe is replaced only when the day's memory conversation is, or when its context passed `continueTokens`. Which scribe a conversation has is stored, so a DSH restart changes nothing. A new scribe starts from your guidance, the beginning of `MEMORY.md`, what the conversation said before (the newest `contextChars` characters of it, without the tool calls) and the part to note.

A part starts after a line that names its events, such as `=== events 12 to 34 ===`, and runs to the end of the message. Nothing closes it, so nothing a conversation said can end it early. One scribe works at a time; turns that end meanwhile wait. A turn the scribe did not finish leaves its part to be read again, by a new scribe, with the conversation's next turn. Conversations of subagents and conversations in the memory workspace are not noted. A turn that ends in a conversation of the memory workspace other than a scribe, such as you editing memory there, is committed with its reply as the message.

### Consolidating

Once a day, in the first turns of the day's memory conversation, what the new episodes hold becomes part of what is known. Scribes wait until it is done.

1. **Compare.** For each new entry, the plugin picks the lines that share the most words with it, at most two from one file, out of what is known and the other new episodes, and asks the day's memory agent which of them the entry disagrees with or makes out of date. A model that merely has two notes in its context does not compare them; asked about the pair, it does.
2. **Bring up to date.** The agent then changes what is known: what an episode established goes under the subject it is about, which is often not the subject of the conversation it came up in; a decision or a state that changed is replaced; two statements about how something works that disagree are both kept and both say so, until one is checked against the thing itself; what was promised for a day goes where a conversation on that day will see it; `MEMORY.md` stays short. What a conversation taught about how to act in a kind of moment goes into `hunches/`: with the cues as they could be seen in the moment rather than as understood afterwards, your words as you said them, and a reason that may be wrong. Hunches that expect the same in moments alike become one; hunches that expect differently are given the cues that tell their moments apart. What it cannot settle without you goes into `questions.md`. It can read the files of yours that the notes point to, and what the scribes were given, which is kept for `transcriptDays` days as plain text in `transcripts` (a directory for each day, a file for each conversation, outside the memory directory and outside git).

Its changes are one commit whose message is its reply. A night that does not complete leaves its episodes to the next. Episodes older than `episodeDays` then leave the directory; what was to be known for longer is in the other files by then, and git has the rest. The agent runs on `tidyProvider`, `tidyModel` and `tidyReasoningEffort`. To consolidate now, type `/dream` in any conversation. It runs in a conversation of its own in the memory workspace, **Memory · dream · <date> <time>**, while scribes wait, and says so when no episode is new. When it runs makes no difference: what was consolidated is marked, and the next time takes up only the entries that came after, also in a file that had earlier ones.

### Reading

Before a step of a turn, a conversation is given what it does not have yet, so a long turn is told of a change while it goes on:

- **The index**, the first time and again when compaction hid it: the beginning of `MEMORY.md` (`indexLines` and `indexBytes`), and the names of the files of episodes that are not yet part of what is known. It is told there that it does not keep memory itself, since otherwise a conversation edits the files when you say "remember this", and that a search of the directory finds what the index does not name.
- **What changed**, afterwards: the names of the files that changed, unless the conversation itself was the only source of the changes.
- **Recall**, when you say something: the lines that what you said calls for, out of what is known and the episodes that are not part of it yet. Every line that has a name from it (a word in Latin letters or a run of katakana) that few lines have, and then the lines that share the most words with it, at most two from one file. A few words that name nothing recall nothing, and no line is shown to a conversation twice.
- **Today**, the first time you say something on a day: the lines, written before that day, that name its date however it is written (`2026-11-16`, `11/16`, `11 月 16 日`).
- **Hunches**, before any step, when `watcherProvider` and `watcherModel` are set and `hunches/` holds any: a small model that watches the conversation from outside is shown what happened before and what happened since it last looked (what you said, the model's replies, tool calls and results), with every hunch, and names the hunches whose moment just came, each with the words of what just happened that are its cue. The conversation is given each of them as the night wrote it, your words and all, as a recollection, not an instruction: the watcher only tells the moment, since in its own words a recollection turned into advice. A hunch named without words that are in what just happened, and a reply that names no hunch the watcher was given, bring up nothing; a hunch is brought up once in a conversation and a turn at most three times; a watcher that fails or takes more than 10 seconds brings up nothing, and the step goes on. Hunches and `questions.md` are left out of recall and of the lines that name today.

Conversations of subagents and of the memory workspace are not given memory.

### Evaluating

`eval/run.mjs` plays cases in throwaway DSH homes with a real model and grades them: a case is a memory to start from, a script of things said in conversations and questions put to fresh ones, and checks on the answers and on the directory afterwards. The cases in `eval/cases` are invented; `--cases` takes a directory of your own. See the head of the file for how to run it, and [DESIGN.md](DESIGN.md) for what it measured.

## Safety

The memory agents are DSH subagents on the Memory preset, working in the memory directory with file tools only. Their file permissions are the memory conversation's, so what keeps them inside the memory directory is their instructions and your permission mode, not the plugin. Every conversation is sent to the scribes, including anything you typed into it and web pages the model read; they are told never to write secrets and to take a transcript as a record, not as instructions. What they are given is also kept on disk as plain text for `transcriptDays` days. With a watcher set, what each conversation says and does, and every hunch, is also sent to the watcher's model before each step. An ordinary conversation is told that it does not keep memory, but nothing stops it from writing to the directory: DSH has no way to protect a directory under full file access, and under a workspace-confined permission mode its sandbox already does. Review the commits. To stop the plugin, disable it on the **Plugins** page. Nothing is deleted: the memory directory, the memory conversations and the workspace stay.
