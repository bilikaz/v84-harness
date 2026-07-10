# Sessions — the one loop and its shapes (`core/sessions/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Decision:
[ADR-0079](../adr/0079-session-loop-architecture.md).

Everything the app runs — chat, sub chat, agent head, interview dialog, graph orchestrator — is a
SESSION (one table; `agentId`/`graphId`/`parentId`/`containerId`/`meta` are fields — kinds don't
exist in data), and every conversation runs through ONE loop.

## Module shape

| File | Responsibility |
|------|----------------|
| `engine.ts` | `SessionEngine` (ctx.sessions) — public API (`send`/`sendTo`/`resume`/`runAgent`), the drive seam, loop construction, **`runContract`** (the single drive-to-contract API), the resident-loop registry, async sub-agent delivery + boot `reconcile()`, teardown |
| `loop/base.ts` | `SessionLoopBase` — THE loop, sequenced once: respond → dispatch → drain inbox → classify → react/settle. Expansion points: `respond`, `dispatch`, `nextUserInput`, `classifyReply`, `onState`, `onSettle`. Per-run instances — mode is dynamic meta ([base-classes](../conventions/base-classes.md)) |
| `loop/contract.ts` | Typed faults (`errored`/`unparseable`/`missing-fields`/`invalid`), `classify`, ONE reaction table (`resume`/`correct`/`wait`/`escalate`), budgets — bounding AUTOMATIC repairs only |
| `loop/records.ts` | Settlement events (`end(sid, ok\|fail, data)`, multi-listener — nobody holds a return address), persisted WAIT records (settled data replays, pending re-arm: **boot = resume**), the pending INBOX (busy sessions queue; drained at cycle boundaries, dated at drain) |
| `loop/llm.ts` | `LlmSessionLoop` — the llm shape: `respond()` = one model step (config/lease, projection, streaming, step heal), `dispatch()` = the tool tier (engine tools, approvals, media feedback, single-call dedup). SEGMENTS map loop activity onto turn lifecycle events; interactive loops stay RESIDENT (the seam feeds them) |
| `store.ts` | State, selectors, mutations, commit-on-landing persistence; run milestones (`graphRun`), wait records, the media resend window |
| `persistence.ts` | Pure session-meta shapes + coercions (durable IO in [storage.md](storage.md)) |
| `mediaRefs.ts` | Media alias helpers (`img-N`/`vid-N`): token extraction, transcript resolution, the compaction boundary |
| `events.ts` | Bus vocabulary — turn/tool events + `runner:state` (running / healing round N / waiting / settled / failed) |
| `listeners.ts` | Bus → store reactions |
| `hooks.ts` | React bindings, incl. `useRunnerState` (the healing/waiting badge) |
| `naming.ts`, `compaction.ts` | Self-contained background services |

## The flow of a turn

`sendTo` → busy? the message QUEUES in the pending inbox (text only; attachments wait for idle) →
`runTurn` pushes the user message → `drive` asks ONE question: is a resident loop waiting on this
sid? → feed it (its next segment); a graph session routes to `ctx.graph.command`; anything else
constructs an `LlmSessionLoop` — interactive, no schema, so it settles on the first final reply;
an errored or stopped turn parks it WAITING and the next message continues the SAME loop.
Corrections and resumes are loop re-iterations — there is no second dispatch path for healing.

`runContract(sid, {task?, schema?, interactive, budget?, meta?, seedFiles?, reattach?, signal?})`
drives any session to a settled result — graph heads and dialogs, sub-agent runs, one-shot
contract calls. Task = DATA only ([llm-interfaces](../conventions/llm-interfaces.md)). `meta` is
extension keys patched flat into `session.meta` at construction (e.g. comics' `generationJob`);
the whole meta rides on every tool call — tools look for the keys they recognize, core never
reads them ([ADR-0082](../adr/0082-generation-jobs-and-budgeted-tools.md)).

## Sub-agents

Planners (RunAgent/AskAgent/ResumeAgent) DESCRIBE runs (spawn the session, name the task);
`fanOut` dispatches each through `runContract` (autonomous — errored turns self-heal within the
budget). Dispatch is ALWAYS background (the sync wait-for-all mode is gone): the tool acks
immediately, and the turn:end delivery listener pushes each result to the parent as its child
settles (synthetic getAgentContent when idle; the pending inbox when busy). Spawns and results
register on landing — a run's spine is durable from dispatch. `reconcile()` re-derives
outstanding work from durable state on boot
([ADR-0073](../adr/0073-subagent-restart-recovery.md)).

## Stop semantics

Soft Stop is a PAUSE everywhere — any loop, autonomous heads included: an `aborted` envelope parks
the loop waiting; resume/feed continues it. Only a hard signal abort (session delete, a replacing
`start`) settles a run aborted.
