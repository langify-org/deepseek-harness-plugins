# How this memory is built, and why

English | [日本語](DESIGN.ja.md) | [中文](DESIGN.zh.md)

This is the reasoning behind [`@langify-org/dsh-memory`](README.md): what it borrows from how people remember, what each part was measured to do, and what was tried and left out. The README says what the plugin does; this says why.

## What memory is for

Memory is for the conversations that were not there. A conversation keeps its own history; what it lacks is what other conversations found out, decided and promised. So memory is judged by one thing: whether a later conversation does the right thing without asking again.

Two principles come from Anthropic's [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory), and both held up here:

- Tell a strong model what memory is for, not how to keep it. Every instruction in this plugin is a statement of fact about who reads a note and when. Rules were tried and removed: a rule to "read a file again before changing it" cost a model call a turn, and the fact behind it (the file may have changed, and a change lands only where the text still matches) did the same work.
- Keep what is always loaded small, and let the rest be found.

## Where the first design failed

The first design was one store: scribes wrote notes into topic files as conversations went, and a nightly pass rewrote the directory. Two days of real use showed how it fails, and each failure has a name in the study of human memory.

| What happened                                                                                                                                                                                                                               | What it is                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A fact about a tool was learned in one project's conversation and filed under that project. A conversation on another project needed it, read its own project's file, which said the opposite, and answered wrongly.                        | Retrieval depends on the cue matching how the thing was stored ([encoding specificity](https://journals.sagepub.com/doi/10.1037/h0020071)). The fact was filed under the conversation it came up in and asked for by what it is about. |
| A scribe wrote down the wrong claim while the right note was in the directory. It did so in 10 of 10 replays, also with the whole memory in its context and told to flag disagreements. The nightly pass, which read every file, kept both. | Two memories are integrated when the old one is reactivated against the new, not when both merely exist. Being in context is not being compared.                                                                                       |
| The nightly rewrite dropped why things were decided: 7 or 8 needed facts a run, by an independent review.                                                                                                                                   | Consolidation extracts the gist. In people the gist is added and the episode stays ([Winocur & Moscovitch](https://doi.org/10.1017/S1355617711000683)); here the gist replaced it.                                                     |
| Notes drifted into a chronicle, and the index was rewritten every turn to track the state of the moment.                                                                                                                                    | One store was serving as the record, the knowledge and the to-do list, which have different lifetimes.                                                                                                                                 |
| A promise for a day was remembered only if the nightly pass had put it in the index.                                                                                                                                                        | A promise for a time is recalled by the time, not by what it is about ([prospective memory](https://doi.org/10.3389/fnhum.2015.00392)).                                                                                                |

## The design

The fix is the division of labour that brains use ([complementary learning systems](https://pubmed.ncbi.nlm.nih.gov/27315762/)): a fast store that records what happened and is not rewritten, a slow store of what is known that is made from it, and recall that is driven by cues.

| In people                                                                          | Here                                                                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The hippocampus records episodes quickly, as they happen                           | A scribe per conversation replies with an entry after each turn; the plugin appends it to `episodes/`. A scribe writes no file      |
| Sleep replays the day and builds knowledge from it; the episode is not overwritten | Once a day an agent brings what is known up to date from the new episodes. It never edits an episode                                |
| An old memory changes only when it is reactivated beside the new one               | Before that, the plugin sets each new entry beside the lines it may be about and asks which disagree                                |
| Knowledge is organized by what it is about, not by when it was learned             | What an episode established is filed under its subject                                                                              |
| A cue brings back what matches it; a name brings back what is known of the thing   | When you say something, the lines that have a rare name from it, and the lines that share the most words with it, are put beside it |
| A promise for a day comes to mind on the day                                       | The first thing said on a day brings the earlier lines that name its date                                                           |
| What is not used fades; the gist stays                                             | Episodes leave the directory after `episodeDays`; what was to be known is in the other files, and git has the rest                  |

Two things do the work, and neither is a rule for the model.

**A question.** A model that has two notes in front of it does not compare them. Asked "which of these lines does this entry disagree with?", it does: the disagreement that scribes missed 10 times of 10 was named 5 times of 5 when the same note and twelve candidate lines were put in one question, and in every nightly comparison since. So the plugin's part is to choose what to ask about, and the model's is to answer.

**A cheap measure of what is about what.** The plugin chooses by counting shared words (BM25 over Latin words and character pairs, so Japanese needs no dictionary), taking at most two lines from one file. The limit matters more than the measure: without it, the lines of the topic at hand fill the list, and the line in another topic's file, the one that was missed, is ranked sixth when the question is the cue and twentieth when the wrong claim is. With the limit it is second to fourth. Sentence embeddings were tried on the same question and ranked it fifteenth and worse. Shared words still miss what only a name connects ("can I send 320 mails through postbox" and "postbox drops what is over 200 a day"), so a name that few lines have brings all of them, as a model does when it searches the notes for the name.

One more thing was learned the hard way. Once the nightly agent saw that a new statement disagreed with an old one, it replaced the old one, in 2 of 2 runs looked at: newer won. But a claim about how something works does not become true by being newer. The agent is now told the difference between a state that changed, which is replaced, and two claims that disagree, which are both kept and both say so until one is checked against the thing itself.

## Hunches: how to act depends on the moment

Two days after this design went into use, a design conversation showed something it did not hold. The model ended nine replies running with an offer of one next step, and the user passed over every one before saying that they wanted to think, not to be handed a step. It had followed the index: "replies short, the point only (as a guide, one short table and one next step)". The history of memory showed where that line came from. "Show one small next step" was learned when the user froze before a bank transfer; "shorter replies" was asked for while the user read long reports. A tidying pass, keeping the index short, had merged the two into one format for every reply and dropped the moment each was learned in, and the user's words. Each line was right; what was lost was where it held.

People keep what to do with the moment it was learned in. A memory whose source is lost is used in the wrong place ([source monitoring](https://doi.org/10.1037/0033-2909.114.1.3)); a category is kept as examples with their context, not only as a summary ([context theory](https://doi.org/10.1037/0033-295X.85.3.207)); an expert's intuition is recognizing a moment as one of a kind, which brings what to expect and what to do (Klein's recognition-primed decisions). A rule kept without its moment is applied by its words.

| In people                                                                                                                           | Here                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| What to do is learned in a moment and comes back in moments like it                                                                 | The nightly agent keeps it in `hunches/`, a file for each kind of moment: its cues, what happened, the user's words, a reason that may be wrong |
| Learning follows surprise, better or worse than expected ([reward prediction error](https://doi.org/10.1126/science.275.5306.1593)) | A hunch comes from a correction, an offer passed over, a pleased user, a mistake, a tool that showed what was not expected                      |
| Distinctions grow finer only where they were needed                                                                                 | Hunches that expect the same in moments alike are merged; hunches that expect differently are given the cue that tells their moments apart      |
| Recollections come unbidden, in the moment, and are weighed                                                                         | A small model watching from outside brings a hunch up before a step, beside what called it up, as what happened then                            |

Three choices follow from the failure.

- **The watcher is outside the task.** A model in the middle of a task keeps to the pattern of its own replies. The scribe, the same model reading the same turns from outside, noted twice that the user had passed over the offer; the conversation did not see it. People reason better about someone else's problem than their own, and seeing their own from outside closes the gap ([self-distancing](https://doi.org/10.1177/0956797614535400)).
- **Cues as they could be seen.** A hunch written with hindsight ("the user wanted to think aloud") cannot be matched when the moment comes again, because the conclusion is not there yet; what was there can be ("the user passed over the offer and widened the question"). In the notes, the user's tentative endings ("…かな") came with requests for work as well; what told the moments apart was the flow of the exchange.
- **A recollection, not an instruction.** Said as what happened, it can sit beside a tool's result, where models discount instructions, and the conversation's model decides whether it fits. This is also why a rule's moment is worth keeping: given a rule, a model applies its words; given a reason, it applies the reason. At first the watcher said in its own words what had happened; on the first day all three of its recollections ended in advice ("it would be better to look first"), and a retelling drops what the original holds. So the watcher only names the hunch, and the conversation is given the hunch as the night wrote it: the watcher tells the moment, memory says what it holds.

What memory cannot settle without the user goes into `questions.md`. Asking is not memory's part. It is a chance to learn, which is a different thing: a scheduled task can ask in the morning, and the answers are noted like anything else said.

### How the watcher was measured

Six invented moments, three runs each, with three hunches and Claude Haiku 5.5 as the watcher. Without reasoning it was right 16 times of 18; both misses named the hunch about a token switch for a diff that had none, while saying that it did not fit. At reasoning effort low it was right 18 times of 18: it said nothing in 1.1 to 1.6 seconds, or brought a hunch up in 2.5 to 5 seconds, reading its prompt from the cache after the first call. Asked to end with the hunch's file, it often shortened the name, so a shortened name is accepted, and a reply that names no hunch is dropped. In a throwaway DSH home, a diff with the token switch brought the hunch up before the next step, and the model asked before committing; a user stuck before a payment was answered with one small first step.

Only naming the hunch, at effort low, it was right 18 times of 18 on the same moments, and 10 times of 10 on five moments against the eight hunches the first night wrote from real conversations (three that should call one up, two that should not).

## What was measured

Everything was run in throwaway DSH homes with a real model (Claude Opus 5.5), by `eval/run.mjs`. Costs are in units of one uncached input token (cache read 0.1, cache write 1.25, output 5). "First design" is the plugin as it was just before this change, including every fix made to it until then.

### What a later conversation gets

|                                                                                                                                                                | First design   | This design |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------- |
| **A real memory** (95 KB, one user). The question that was answered wrongly in use: the answer tells the user what the note under the other topic says         | 0 of 3         | 3 of 3      |
| The same question after a night                                                                                                                                | not run        | 2 of 3      |
| **The real wrong claim is said again, then a night.** Where the claim is written, memory says that another note disagrees                                      | 0 of 3         | 3 of 3      |
| The note it contradicts is still there, as it was or as one side of the disagreement                                                                           | 3 of 3         | 2 of 3      |
| A conversation asked the next day tells the user of both                                                                                                       | 0 of 3         | 3 of 3      |
| **An invented memory** (75 KB, ten files), six questions that each need a fact noted under another project                                                     | 15 of 18       | 16 of 18    |
| The same, two stated procedures that a note under another project contradicts, then a night, then the question (three checks each)                             | 18 of 18       | 18 of 18    |
| **A promise for today**, written days earlier in a project's file and not in the index                                                                         | 0 of 3         | 3 of 3      |
| **An episode older than `episodeDays`**, then a night: it has left the directory, what it established is in what is known, and a later conversation is told it | does not apply | 9 of 9      |
| **One real day of a design conversation** (38 turns) said again, then a night, then six questions on why things were decided                                   | 6 of 6         | 6 of 6      |
| An invented small memory (5 KB), twelve cases, eighteen checks: a decision asked for in another conversation the same day, updates, reasons, promises, chatter | 54 of 54       | 54 of 54    |

On the real question, the line that was needed was put beside the question in every run. Four versions of this design were run on it, with and without a night before, 24 runs in all: the answer told the user of the note in 20, and also reached the right conclusion in 6. The first design did neither in any of 3. The conversation reads the code in front of it, finds what the prototype does, and often decides that the note overstates. Memory's part is that the user hears of the note; before, the user did not.

The night is not safe either. In 1 of the 3 last runs the nightly agent took "the user read the code" for a check of the claim and corrected the right note, leaving a line that says what it used to say. The first design never touched that note, because it never noticed.

Of the six invented questions, five name the tool the fact is about, and for those the needed line was recalled in 15 of 15 runs. The sixth connects only through a second step (the question is about a camera, the camera's file says it is reached over a VPN, the fact is about the VPN key) and was answered in 1 of 3, against 2 of 3 by the first design: a conversation gets there by searching, or does not.

### What it costs

|                                                                   | First design                               | This design                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Scribes, the real day of 38 turns                                 | 939,000 in 75 model calls, 51 file changes | 465,000 in 38 model calls, no file change                                                                |
| The night after that day                                          | 432,000                                    | 469,000 (comparing 124,000, bringing up to date 345,000)                                                 |
| A night with nothing new, on the invented memory of 75 KB         | 263,000                                    | 147,000                                                                                                  |
| Scribes, the twelve small cases together                          | 159,000                                    | 115,000                                                                                                  |
| A question to a fresh conversation, invented memory               | 27,600 in 1.8 tool calls                   | 25,500 in 1.4 tool calls                                                                                 |
| The real question, which the conversation answers by reading code | 65,000                                     | 74,000 to 164,000 over the four versions: it looks into the disagreement                                 |
| What recall adds to a conversation                                | nothing                                    | at most 14 lines a message, about 3,100 characters for a question of two sentences; nothing for "thanks" |

What a scribe is given can be cut further: without tool results and with tool calls cut to 140 characters, the same day cost the scribes 355,000 and the six questions were still answered. The defaults were left as they are, since one day is not enough to know what the results held that nothing else did.

What the numbers do not show: every count is of 3 runs or fewer per case, the real cases are one person's memory, and the invented memory was written for this evaluation. Which design does better on a row was the same from run to run; by how much is not established. The rows were run on the version of the day. The last version changed only which episodes are looked through, and was run again on the real cases, the promise for today, the old episode, the decision asked for the same day and the chatter.

### How hard the night thinks

Whether the night settles a disagreement the right way may depend on how hard the model thinks. The real wrong claim was said again and a night run, 10 times each with the nightly agent's reasoning effort at high, xhigh and max. At max, 4 of the 10 runs went past the 15-minute limit; the 6 that finished are counted.

|                                                                                          | high     | xhigh    | max     |
| ---------------------------------------------------------------------------------------- | -------- | -------- | ------- |
| The night looked into the sources or the code and settled the disagreement the right way | 1 of 10  | 5 of 10  | 5 of 6  |
| The night made the wrong claim the settled truth                                         | 0 of 10  | 0 of 10  | 0 of 6  |
| The right fact is still there for a reader to see                                        | 10 of 10 | 10 of 10 | 6 of 6  |
| The next day's answer tells how it really works                                          | 7 of 10  | 8 of 10  | 2 of 6  |
| Cost of a night with one new entry (median)                                              | 66,000   | 200,000  | 590,000 |
| Places rewritten on a night with nothing new (median)                                    | 0        | 6        | 17      |
| Cost of the next day's answer (median)                                                   | 180,000  | 76,000   | 64,000  |

The harder it thinks, the more often the night goes to the sources itself and settles the disagreement; at high it mostly writes down that the two disagree. At xhigh the night has settled it, so the next day's conversation answers right without looking into it again, at about 4 tenths of the cost at high: what the night spends comes back the next day. Max did no better than xhigh, at three times the cost of a night. The cost grows with effort not only from thinking but from reading and rewriting more. Without being told to, the xhigh night wrote the settled fact in one file and pointed to it from the other topic's file with one line and a link, in 6 of 10 runs.

The first grading was wrong. It asked what the table under "What a later conversation gets" asks: whether memory says, where the claim is written, that another note disagrees, and whether the answer tells the user of the note under the other topic. Those fail a night that settled the disagreement the right way: once it is settled, there is no dispute to mark and no other note to bring up. By them xhigh looked worse than high (the answer told the user of the note in 4 of 10 against 9 of 10). The checks in the table above ask instead whether what is known keeps the right fact and whether the night made the wrong claim the truth, and the answers were counted from their text.

In the author's own use the nightly agent runs at xhigh. Its first real night, seven conversations into about 200 KB of what is known, took about 9 minutes and about 920,000 (comparing 181,000, bringing up to date 738,000). A night started by hand the day before at high, on 174 KB, took about 6 minutes and about 780,000. The two read different amounts, so this does not measure the difference.

## What was tried and left out

- **Giving a writer the whole memory**, so that it notices what it contradicts. 0 of 10, at 2.2 times the cost. What is in context is not compared.
- **Sentence embeddings** to choose what to compare and recall. On the question that failed in real use they ranked the needed line 15th to 29th of 306; shared words ranked it 6th, and 2nd with the limit per file. They also need a second model. Not used.
- **DSH's compaction** in place of replacing a long-lived scribe. 35 of 58 attempts failed: the scribe takes the request to condense for more of the conversation it is noting.
- **DSH's session tools** for checking notes against conversations. Their search is off unless an experimental bundle is enabled. What the scribes are given is kept as plain text instead.
- **A guard against ordinary conversations writing to memory.** DSH has no way to protect one directory under full file access, and a guard in this plugin would have to know other plugins' tools. Conversations are told that they do not keep memory, which was enough in every test.
- **A fork of the conversation as the writer.** It sees the reasoning and everything read, but every step re-reads the whole conversation: 2.5 times the cost on a short conversation, more as it grows. Not used; noting is done by a scribe that is given the part.
- **Following recalled lines one step further** (the names in the lines that were recalled bring their lines too). Tried on the six invented questions and the real one: it reached the needed line in none that the first step had missed, and added six to eight lines that had nothing to do with the question.
- **Looking through every episode** when recalling and comparing, not only those that are not yet part of what is known. Four versions did; no case had weeks of episodes, so nothing showed for or against. Left out: the lines to look through would grow by the day and crowd out what is known, and an old episode is reached through what is known, which names it, or by searching.
- **A shared format ([Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)).** Its unit is a file with metadata for the file; these notes hold many statements a file, and what matters (where a statement came from, until when it holds) is per statement.
- **Memory as numbers rather than text** (soft prompts, steering vectors, per-user LoRA, model editing). None can be done to a hosted model, and published results favour retrieval for facts. What can be done is what this plugin does: compute over the text, and give the model the text that the computation picked.

## What is not known

- Whether what is known stays good over weeks. One night was measured, not thirty.
- How often recall shows lines that do not matter, and what that costs a long conversation. Lines are not shown twice, which bounds it.
- Whether a conversation, shown a note that disagrees with what it finds, sides with the right one. It tells the user of both; on the real question it then reached the right conclusion in 6 of 24 runs.
- How to keep the nightly agent from settling a disagreement the wrong way. Told that a claim is not right for being newer, it still took a report of having read the code for a check, in 2 of the 9 runs of the real case. More reasoning effort makes it go to the sources more often: at xhigh it settled the disagreement the right way in 5 of 10 runs and the wrong way in none, and left both sides in the rest.
- What a night at xhigh or max rewrites when nothing is new. It rewrote 6 and 17 places where high rewrote none; whether that drops why things were decided, as the first design's night did, was not measured.
- The thresholds. That a name is rare when at most 12 lines have it, and that a line is about what was said from a score of 15, were set on seven questions and four pieces of chatter.
- Other models. Everything here was Claude Opus 5.5; a weaker model may need more than facts.
- Whether the nightly agent writes hunches with cues that can be seen in the moment. It is told to; that was not measured.
- How often the watcher speaks out of turn over weeks, and whether the conversation's model learns to pass it over, as people stop hearing an alarm that rings too often. A hunch is brought up once in a conversation, which bounds it.
