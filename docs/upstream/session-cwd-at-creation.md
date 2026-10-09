# Draft: let plugins choose a new session's working directory, and announce archive changes

Status: draft for an issue on [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). Not posted yet.

---

**Title:** Plugin hook to choose a session's working directory at creation (and an archive event)

### Problem

A common setup gives every agent session its own directory, usually a git worktree, so that parallel sessions on one repository do not edit the same checkout. Claude Code (`--worktree`) and Codex offer this directly.

A DSH plugin cannot do this today. A session's `cwd` is part of its header: `session.create` takes a `workspaceId` or a `cwd`, the API session controller passes it to `agents.create({ meta: { cwd } })`, and the session boundary validates and freezes it before any plugin code runs. The first plugin hook, `agent/created`, sees an already fixed directory. There is no waterfall before creation (in 0.2.0-rc.2, the only lifecycle waterfalls are `agent/pre-step`, `agent/request`, `agent/request-error`, and `workspace/session-activity`).

The workaround in [`@langify-org/dsh-session-hooks`](https://github.com/langify-org/deepseek-harness-plugins/tree/main/plugins/session-hooks) creates the worktree in `agent/created` and injects a notice that tells the model to work there. The model follows it, but everything else still uses the original directory: the bash tool's default working directory, the sandbox workspace root, the file panel, `@` file references, and the session's place in the sidebar.

### Proposal

A Host waterfall event before a root session is created, for example:

```ts
interface Events {
  /**
   * A root session is about to be created. Listeners may return another
   * absolute, existing directory for it; the session records the result as its cwd.
   * @mode waterfall
   */
  'session/creating'(
    request: { sessionId: SessionId; cwd: string; workspaceId?: WorkspaceId; agentPreset?: string; signal: AbortSignal },
    next: () => Promise<{ cwd: string }>,
  ): Promise<{ cwd: string }>
}
```

Emitted from the API session controller's creation path (`createOrAdopt`) or from `AgentRegistry.create` for root agents, before `meta.cwd` is validated. Subagents, forks, and resumed sessions keep their current rules.

Open question: workspace membership. A worktree path does not match its project's path, so the session would not be grouped under the project. Options are to keep the requested `workspaceId` as the session's workspace even when `cwd` differs, or to let the listener return the workspace too.

### A smaller related request: an archive event

There is no event when a session is archived or restored. A plugin can only diff the archive set in consecutive `domain/changed` writes of the workspace domain's global record, which relies on that record's internal shape. An emit-mode event from `WorkspaceRegistry.archiveSession` and `unarchiveSession` after the durable write, for example `workspace/session-archived` and `workspace/session-unarchived` with `{ sessionId }`, would make cleanup on archive straightforward.

### Use cases

- One git worktree (and branch) per session, created at session start and removed on archive.
- A scratch directory or container mount per session.
- Moving a session into a prepared environment chosen by policy (per user, per ticket).
