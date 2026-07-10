# ADR-0079: One supervised session loop — drivers, contract-in-loop, settlement events

Status: Accepted
Date: 2026-07-09
Supersedes the turn-loop shape of [ADR-0058](0058-conversational-sub-agent-orchestration.md)'s
sync-await mechanics and the dialog/head machinery of [ADR-0069](0069-message-driven-graph-control.md)
(the message-driven control itself survives — see [ADR-0080](0080-graphs-as-response-producers.md)).
Present-tense map: [architecture/sessions.md](../architecture/sessions.md).

## Context

Every conversation kind had its own private engine: `modelTurn` (a 300-line step loop), the graph
engine's `awaitHead` (heads) and `onDialogTurn` (dialogs) — two hand-rolled variants of
"drive a session until a reply satisfies a JSON contract" — plus the sub-agent tier's
`awaitSettled`. Live testing produced a family of defects with one root: the engine envelope leaked
into node code (`[object Object]` dead ends), an errored head gave up where chat knew how to
resume, healing was invisible ("is it dead or thinking"), run state was ad-hoc in-memory while
messages persisted, and a busy session refused injection. Each copy drifted independently —
the exact failure documented in conventions/consolidation.md.

## Decision

**Everything is a session; every conversation runs through ONE loop** (`core/sessions/loop/`):

- **`SessionLoopBase`** sequences the only loop: respond → dispatch tool calls → drain the pending
  inbox → classify → react/settle. An iteration IS the step; "a turn" is just iterations until a
  text-only response. Subclasses are response producers (`LlmSessionLoop`: lease, projection,
  streaming; `GraphSessionLoop`: nodes as tool calls) and never touch sequencing. Per-run
  instances (base-classes convention) make mode DYNAMIC: each entry constructs the shape the
  session's current meta selects.
- **The contract lives IN the loop** (`loop/contract.ts`): typed faults (`errored`, `unparseable`,
  `missing-fields`, `invalid`) and ONE reaction table — same fault, same reaction, regardless of
  whose session. Reactions are re-iterations (resume drops the broken tail; corrections are
  engine-authored turns) — there is no second dispatch path for healing to diverge from. Budgets
  bound AUTOMATIC repairs only: interactive degrades to waiting (a user can always steer),
  autonomous escalates (`ok: false` — the level above decides). `interactive` is one table column,
  not a second code path: it names who supplies the next input.
- **Settlement is an EVENT** (`loop/records.ts`): `end(sid, ok|fail, data)`, any number of
  listeners; nobody holds a return address. **Waits persist** ("A settled — data stored; B, C
  pending") in session meta; on load, settled children replay and pending ones re-arm.
  **Boot = resume**: loading unsettled state and continuing is normal operation, not a feature.
- **The pending inbox**: injection into a busy session is never refused — it queues (user messages,
  sub-agent deliveries) and the live loop drains it at its next cycle boundary, entering the
  transcript at drain time so order holds.
- **Soft Stop is a pause everywhere** — any loop, autonomous heads included; only a hard signal
  abort settles a run aborted. A stopped head stays resumable.
- **`runContract(sid, spec)`** is the single public API for driving a session to a settled result
  (graph heads/dialogs, sub-agents, one-shot runs). The sub-agent planners describe runs; `fanOut`
  dispatches them through it — `awaitSettled` is deleted.
- Lifecycle is observable: `runner:state` events (running / healing round N / waiting / settled /
  failed); the UI renders healing/waiting above the composer.

*Alternative rejected:* a contract layer beside the loop (built twice as `SessionRunner`/converse
and deleted) — bolting supervision next to the turn machinery re-created the seams and the drift.

## Consequences

- One home per rule; the engines shrank (sessions ~760→~460, graph 571→96) while total logic moved
  into reusable modules. Sub-agents gained self-healing for free.
- Unit mechanics (streaming, tool dispatch, projections, leases) stay inside `LlmSessionLoop` —
  deliberately NOT merged into the loop.
- Deferred: the async delivery pump's synthetic fabrication still uses its queue (behind one
  interface now); fan-out revival does not yet consume the wait store; media cannot ride a pending
  inbox record.
