# ADR-0080: Graphs are response producers — nodes emit real tool calls

Status: Accepted
Date: 2026-07-09
Builds on [ADR-0079](0079-session-loop-architecture.md); supersedes the executor mechanics of
[ADR-0067](0067-graph-orchestration-engine.md) (the node model — Start/End pairs, routes, joins,
break/park — survives unchanged) and keeps the command language of
[ADR-0069](0069-message-driven-graph-control.md).
Present-tense map: [architecture/graph.md](../architecture/graph.md).

## Context

The graph engine was a second engine beside the chat loop: it faked turns (segment machinery) to
satisfy the session UI, HAND-EMITTED `tool:calls`/`tool:result` events (`openCard`) to render
cards for work that wasn't tool calls, and owned private copies of head/dialog conversation logic.
The simulation was the smoking gun: the graph was already pretending to be a model that emits tool
calls.

## Decision

**The graph is a deterministic response producer over the one session loop** (`core/graph/loop.ts`,
`GraphSessionLoop`):

- **The user's commands are its prompt**: `respond()` interprets the transcript's command message
  (`start` / `continue` / `<node> {json}` / help). Value nodes advance inline; every EXTERNAL node
  action is emitted as a **real tool call** — a head or an interview dialog is a `Call`, a Select
  is a `Select` — and `dispatch()` executes them (`Call` → `runContract`, `Select` → the select
  bridge), emitting the ordinary tool events. Cards, child links, and results are real because the
  calls are real.
- **Park (`ctx.break`) is a `yield`**: message printed, loop waits; `continue` feeds it.
  Settlement happens ONLY at the reserved exit node. A head that spends its budget parks WITH its
  child session; `continue` reattaches the SAME agent.
- **Turn semantics**: autonomous calls keep the command turn open (a fast run's `start` returns the
  final output); an interactive call closes it (an interview pending for days never holds the graph
  session streaming). Commands while the loop is blocked in dispatch act out-of-band
  (`continue` resumes the soft-stopped children).
- **Revival**: the persisted milestone cursor (`SessionRuntime.graphRun` — node, head, input,
  dialogSurface) + the transcript; `continue` on a session with no live loop constructs one parked
  at the cursor, reattaching a recorded dialog surface (transcript intact, no task re-post).
- `GraphEngine` is a 96-line shell: the live-loop registry and command routing (`start` = hard-kill
  + fresh). Node services (`scan`, `runTool` with media-alias pre-resolution) are exported
  functions in `loop.ts`. The graphs' NodeAction API is unchanged — plugin flows run as-is.

*Accepted regression:* fan-out members advance as a batch (dispatch is `Promise.all`), losing
per-member pipeline overlap — only the review graph fans out today; streamed per-settlement
dispatch is a later refinement.

## Consequences

- One conversation implementation for the whole app; graph bugs stopped being a separate class.
- The `Call` card replaces node-named cards (arguments carry `node`/`head` for display).
- Multi-track fan-out revival needs the wait store (persisted arrivals) — deferred; single-track
  flows (comics) revive fully.
