# ADR-0069: Message-driven graph control, explicit exit node, node-validated breaks

Status: Accepted
Date: 2026-06-29
Supersedes the control/termination parts of [ADR-0067](0067-graph-orchestration-engine.md) (the `run(sid)`
seam, the `done` route, "stop/continue act only on children", the `ai`-Select placeholder). The node model,
arrival-driven joins, seeded heads + JSON heal from ADR-0067 stand unchanged. Reuses the sessions turn loop
([ADR-0019](0019-reference-stable-transcript.md)/[ADR-0020](0020-persist-at-turn-completion.md)) and the
Select Promise bridge ([ADR-0013](0013-approval-promise-bridge.md)). Present-tense map:
[architecture/graph.md](../architecture/graph.md).

## Context

ADR-0067's first cut drove a graph through `drive() → ctx.graph.run(sid)`: `run` started a fresh run from the
entry node whenever no live run existed, and the right-panel buttons poked a private `ctx.graph.start/continue`
API. Three failures surfaced in use:

1. **Silent auto-restart.** A finished graph re-ran itself from the entry with no user action. Root cause: graph
   child heads carry `parentId = orchestrator`, so the generic async child-delivery machinery
   ([ADR-0060](0060-async-subagent-delivery.md)) treated the orchestrator as a sub-agent parent. At settle the
   orchestrator's own `turn:end` re-fired `pumpDeliveries`, a queued child delivery drained into
   `drive(parentSid)`, hit the `graphId` seam, found no live run, and started over.
2. **Magic control.** Start/Continue ran on a side-channel API, not the chat. Clicking Continue on a finished
   run (no live run) fell through to a fresh `run()` — a restart, not a resume.
3. **Auto-values.** An unanswered/empty Select silently got a value chosen *for* the user — plugin `end`-half
   defaults (`ROSTER.slice(0,3)`, all-files) and the engine's `ai` placeholder picking `options[0]`.

## Decision

**A graph session is a chat; control is command messages, and the engine never drives itself.**

- **Seam → `command(sid, text)`.** `drive()` for a `graphId` session delegates to `ctx.graph.command`, which
  parses the message: `start` (kill any live run, fresh from entry, no input), `continue` (resume the live run),
  `<nodeName> {json}` (kill, jump into that node with the JSON as input). An **empty** drive (a stray resume) is
  a strict no-op — never a restart. Anything else returns a **help** message listing the commands + the graph's
  node names (`Object.keys(graph.nodes)`). The right-panel buttons send `start`/`continue` *messages* (real
  turns), so the buttons and typing are one path.
- **Graph orchestrators are not delivery parents.** The `turn:end` async-delivery hook skips a child whose
  parent is a graph session — heads are consumed by `awaitHead`, never the pump. This (plus the empty-drive
  no-op) closes the auto-restart.
- **Termination is the reserved `exit` node, not a `done` route.** `Route` drops `{ done }`. `BaseGraph` owns a
  built-in `exit` node (symmetric to `entry`); a graph ends by routing to it (`{ goTo: "exit", input }`). The
  exit node renders its input as a fenced ` ```json ` block — the final chat output — and the engine settles.
  Output is consistent and copy-pasteable (heads already return JSON); plugins no longer hand-format reports.
- **A run can pause without ending; `continue` resumes wherever it is parked.** A soft Stop pauses the running
  children; a node **breaks** via `ctx.break(message)` (throws an internal `GraphBreak`) when its `end()`
  rejects the response (e.g. an empty required Select). On a break the engine **parks** the run at that node
  (the RunState stays alive, the message is posted, the turn ends — not an error). `continue` re-runs the parked
  node (re-surfacing the Select) or resumes the stopped children. Validation lives in the node, so there is no
  engine-level `required` flag and **no silent default** — `ai`/empty Selects resolve to `[]` and break.

A break thrown synchronously inside `start()`/`end()` is made catchable by invoking the half via
`Promise.resolve().then(() => node.half(...))` so the throw becomes a rejection the engine routes to park.

## Consequences

- A graph reads as one chat driven by visible `start`/`continue` messages; a finished run sits idle until the
  user sends `start` again. No phantom restarts.
- Empty/cancelled Selects are honest: the run parks with a node-authored message and resumes on `continue` to
  the same choices — the user is never silently committed to a default.
- The final output is always a `json` block; deterministic per-plugin report formatting (`formatReport`) is gone.
- Run state (including a park) is still in memory only — an app restart does not resume; `continue` then reports
  "nothing to continue — send `start`" (consistent with ADR-0067's no-cross-restart stance).
- `GraphBreak`, the `exit`/`EXIT_NODE`, and `toJsonBlock` live in `core/graph/base.ts`; the command router,
  park/segment lifecycle, and exit-as-terminal live in `core/graph/engine.ts`.
