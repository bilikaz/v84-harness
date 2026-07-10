# Graph orchestration (`core/graph/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Decisions:
[ADR-0080](../adr/0080-graphs-as-response-producers.md) (the driver),
[ADR-0067](../adr/0067-graph-orchestration-engine.md) (the node model),
[ADR-0069](../adr/0069-message-driven-graph-control.md) (command language),
[ADR-0068](../adr/0068-plugin-agents-code-registry.md) (plugin agents).

## What a graph is

The harness is ReAct-driven by default ([sessions.md](sessions.md)); a **graph** is event-driven
orchestration: plugin code — an `entry` node + named nodes, each a `Start`/`End` pair, routing via
`goTo`/`splitTo`/`goToAll` to the reserved `exit` node (rendered as the final ```json output).
Producer-declared arrival-driven joins; `ctx.break` parks the run.

## The driver (how it executes)

A graph is a **response producer over the ONE session loop** ([sessions.md](sessions.md)):

| File | Responsibility |
|------|----------------|
| `loop.ts` | `GraphSessionLoop` — `respond()` interprets the user's COMMAND (`start`/`continue`/`<node> {json}`/help) or applies dispatched results (node `end` → route); value nodes advance inline; every external action is a REAL tool call — a head or interview dialog is a `Call`, a Select is a `Select`. `dispatch()` executes them (`Call` → `runContract`, `Select` → the bridge) emitting ordinary tool events — real cards, no simulation. Park = `yield` (message printed, loop waits). Also exports the NodeCtx services: `scanWorkspace` (enumeration, default `.git`/`node_modules` ignores) and `runNodeTool` (housekeeping calls with media-alias pre-resolution) |
| `engine.ts` | `GraphEngine` (ctx.graph) — a thin shell: the live-loop registry + command routing (`start` = hard-kill + fresh; waiting → feed; blocked-in-dispatch → out-of-band `continue` resumes children), soft stop, hard kill |
| `base.ts` | `BaseGraph`, `EXIT`, the exit render, `GraphBreak` |
| `registry.ts`, `select.ts`, `types.ts` | Graph registry; the Select user-resolution bridge; the NodeAction vocabulary (`value`/`modal`/`dialog`/`agent` — unchanged, plugin flows run as-is) |

Turn semantics: autonomous calls keep the command turn open (a fast run's `start` returns the
final output); an interactive call closes it (an interview pending for days never holds the graph
session streaming). A failed head parks WITH its child session — `continue` reattaches the SAME
agent. Soft Stop pauses children resumably.

## Persistence & revival

The milestone cursor (`SessionRuntime.graphRun`: node, head, input, dialogSurface) persists at
every single-track node boundary; `continue` on a session with no live loop constructs one parked
at the cursor, reattaching a recorded dialog surface (transcript intact, no task re-post).
Fan-out revival awaits wait-store consumption (deferred; persisted arrivals exist in
`loop/records.ts`).

## Dialogs and heads

A `dialog` action runs as an interactive `Call`: on the graph session itself, or — with
`DialogSpec.agentId` — on a fresh ACTIVATED sub chat as a registered agent (purpose-written system
prompt + grounded toolset; the graph session stays clean with cards + results). An `agent` action
is an autonomous `Call` on a spawned head (seed files supported). Both are `runContract` runs —
contract healing, budgets, and `runner:state` visibility come from the session loop, not from
graph code.
