# ADR-0026: Agent sessions — placement follows launch context, capability is masked separately

Status: accepted
Date: 2026-06-11

Supersedes the placement clause of
[ADR-0023](0023-agent-definition-binding-and-ceiling.md) ("a chat agent ALWAYS
runs unbound"). The ceiling and live-lookup clauses of ADR-0023 stand.

## Context

ADR-0023 enforced the chat/workspace capability boundary by forcing chat-agent
sessions unbound: `workspaceId: null` regardless of where they were launched.
That worked because `session.workspaceId` carried BOTH meanings — which sidebar
group the session lives in (placement) and which workspace grants its tools
(capability). Nulling it kept file tools out, but placement was collateral
damage: a chat agent fired from inside a workspace landed in the "Chat" group,
away from the work it belonged to. Live use showed the toggle was always meant
as a *limitation*, not a *separation* — its real purpose is sub-agent grounding
(an orchestrator fanning out to provably unprivileged workers), not dictating
where manually-launched sessions live.

## Decision

**`session.workspaceId` is placement only.** Every agent run is placed in its
launch context's workspace: the explicitly given one, else the active one for
manual runs (null only when launched from Chat); sub-agent children take the
parent *session's* workspace.

**Capability is resolved separately, per turn** (`capabilityContext` in the
driver): the live agent supplies the ceiling, and for a chat-only agent the
workspace is masked to `undefined` across the entire tool path — advertising,
execution, tool cwd, and the fs system prompt. Sub-agent grounding is
unchanged: a chat-only parent's catalog still offers only chat agents, and the
child's own turns mask the workspace the same way. `sessionToolModes` exports
the identical computation for the UI.

**The agent link is visible and severable.** A right-panel card, shown only
for agent-based sessions, names the governing regime (workspace agent with
ceiling / chat-only / agent deleted) and expands to the per-tool effective
modes. **Unlink** converts the session to a plain one — transcript and stamped
system prompt stay, plain workspace/chat permissions apply from the next turn.
One-way; hidden on read-only sub-agent runs (no next message to apply to).

**Degrade-on-delete is reaffirmed, now with teeth.** ADR-0023's "a deleted
agent degrades to the plain workspace policy" stays — but since chat-agent
sessions now carry a real `workspaceId`, deleting (or unlinking) the agent
*expands* those sessions' permissions to the workspace policy. Accepted
deliberately: deleting an agent is a deliberate library act, and the
permissions card announces the state.

## Consequences

- A chat agent's run shows up where you launched it; the sidebar grouping and
  the tool grant no longer share one field's fate.
- The capability mask lives in ONE place (`capabilityContext`) feeding both
  checkpoints and the UI — no second policy path to drift.
- The chat-only promise is only as durable as the agent record: delete or
  unlink, and old sessions inherit the workspace grant. The trade was made for
  zero schema growth; revisit (stamp the boundary on the session) if it bites.
- Run-log cleanup UI rides ADR-0022's data model unchanged: a worker's answer
  is a tool-result message in the parent's transcript, so deleting child
  sessions (one, or all per parent) costs only the child transcripts; deleted
  chips render as tombstones, not gaps.
