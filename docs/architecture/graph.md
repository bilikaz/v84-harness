# Graph orchestration (`core/graph/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Decisions:
[ADR-0067](../adr/0067-graph-orchestration-engine.md) (the engine + the Select primitive),
[ADR-0068](../adr/0068-plugin-agents-code-registry.md) (plugin agents as a runtime-gated registry).
The first consumer is the code-review plugin ([plugins.md](plugins.md)).

## What a graph is

The harness is **ReAct-driven** by default ([sessions.md](sessions.md)): the model decides each step. A
**graph** is the other mode — **event-driven orchestration**. A graph is plugin code: an `entry` node + a
registry of **named nodes**, each a `Start`/`End` pair. The engine runs a node's `start`, and when that work
finishes it calls the node's `end`, which routes to the next node. The graph advances **only on completion** —
no polling loop, no transcript re-scanning.

- **Graph** — a `BaseGraph` subclass (plugin code): `getId`/`getTitle`/`needsWorkspace` endpoints + `entry` +
  the `nodes` map.
- **GraphEngine** (`ctx.graph`) — the one executor all graphs run on. Named `GraphEngine`, not "…Runner",
  to stay clear of the concurrency `RunnerEngine` (`core/runner/`).
- **Graph session** — a running instance: a real session ([sessions.md](sessions.md)) stamped `graphId`.
- **Head** — a running node instance; an agent head is a visible child session under the orchestrator.
- **Group** — a fan-out batch; a join fires when the whole group has arrived.

## The node contract

| Half | Shape | Role |
|------|-------|------|
| `start` | `(ctx, input) → NodeAction` | kicks off the work: `{ modal }` (a Select), `{ agent }` (spawn a child head), or `{ value }` (sync) |
| `end` | `(ctx, input, response) → Route` | fires on completion with **both** the input the head started with and the agent/modal `response`; composes the next step |

Routes (`Route`):

- `{ goTo, input }` — solo: continue as another node (1:1), keeping this head's name + group.
- `{ splitTo, inputs }` — fan out a **new sibling group**, one head per input.
- `{ goToAll, input }` — **join**: go to a node once **every member of this head's group has arrived**.

**Termination is routing to the reserved `exit` node** — there is no terminal route value. `end` can also
**break** the run: `ctx.break(message)` rejects the response and parks the run at this node (see control, below).

**Data flows by passing, never by reading.** A node never reads another node's data — everything a step needs
is in its `input`/`response`. `end` composes the next `input` (the response is *not* automatically the next
input). The graph holds no shared blackboard.

## Joins are producer-declared and arrival-driven

A join node (e.g. `consolidate`) **declares nothing** — it can be reached many ways and can't know what feeds
it. The **finishing head** declares the wait via `goToAll`, because it knows its siblings (its fan-out group).
The engine fires the target once arrivals for that group reach `group.size`.

This is **arrival-counted, never liveness-polled**: you do *not* ask "is any sibling still running" — a head
between stages (finished verify-1, about to start verify-2) is momentarily idle but not done, and polling
would fire the join early and miss it. Counting arrivals against the group size is race-free: a head still
mid-pipeline simply hasn't arrived. The group propagates through `goTo`; `splitTo` mints a fresh one.

## The runner's only storage

The GraphEngine keeps a per-session run state in memory (`runs`, keyed by sid). Its **only** durable-shaped
storage is the **`goToAll` join buckets** (`arrivals` — accumulate a group's responses until it's full).
Everything else is pure input → output; nothing is stored or read back. (`running` — head name → child sid —
and `parked` — the broken node a `continue` re-runs — are live tracking for the chart + stop/break/continue.)
There is **no persistence blob** — only the router needs memory, and only for the join. A full app restart
mid-run therefore does not resume (in-session stop/break + continue do).

## Heads, seeding, and the JSON heal

An `{ agent }` action spawns a child head (`ctx.sessions`, a real sub-agent run). When `AgentSpec.seedFiles`
is set, the engine **seeds the head's opening** by running `Read` on each file for real and writing the result
into the child's history as `[task] → [assistant: Read calls] → [tool: file contents]`, then `resume`-ing it —
so the head starts with the files already in context (the composer-priming pattern, [ADR-0024](../adr/0024-agent-runs-through-composer.md),
extended to carry tool calls). `awaitHead` awaits the child's settle, then enforces the JSON contract:
it **extracts the JSON** from a prose-wrapped reply and forwards the *clean* JSON downstream (not the raw
"here's my review… {…}" text), and heals a mismatch:
- **unparseable** → `resume()` — `resumeTail` **drops the broken reply** from history and retries; the broken
  JSON is **never re-sent** (the provider's chat renderer `json.loads` message content and 400s on broken JSON
  in the request, which would make the model unrecoverable).
- **valid but missing fields** → a targeted "missing field X" correction (the JSON parses, so re-sending is safe).
- an **errored** turn (e.g. a 400) **bails** the heal — it isn't a fixable JSON output.

`ok` reflects the contract (settled **and** valid); a failed head forwards **`""`**, never the error or
garbage — so it's dropped, not pooled or passed to the verifier.

## The Select primitive (`select.ts`)

A selection is one registered concept resolved by `source`: `user` raises a pending entry the **SelectModal**
settles (the same Promise bridge as approvals, [ADR-0013](../adr/0013-approval-promise-bridge.md) —
`requestSelect`/`resolveSelect`/`cancelSelectsForSession`); `pattern` is graph-provided; `ai` resolves to an
empty selection (a TODO until model-consulted resolution lands — **never** a silent auto-pick). An empty answer
is honoured: the node's `end` decides (typically `ctx.break`), it is not defaulted away.
`view: list | tree` is a renderer hint over the same `{ id, selected[] }` result: `list` is single/multi;
`tree` renders nested `options.children` as a cascading checkbox tree (checking a parent checks all
descendants, indeterminate for partial) — used by the scope folder picker.

## Control: commands, breaks, the chart ([ADR-0069](../adr/0069-message-driven-graph-control.md))

Control is **message-driven** — a graph never drives itself.

- **The seam**: the sessions turn loop's `drive()` branches on `session.graphId` → `ctx.graph.command(sid,
  text)`. That one branch is the whole core extension; everything downstream (transcript via the bus,
  persistence at turn end, the sidebar) is reused.
- **Commands** (the message text): `start` (kill any live run, fresh from `entry`, no input), `continue`
  (resume the live run), `<nodeName> {json}` (kill, jump into that node with the JSON as input). An **empty**
  drive (a stray resume) is a no-op — never a restart. Anything else returns a **help** message (the commands +
  the graph's node names). The **Flows** buttons send `start`/`continue` *messages*, so buttons and typing are
  one path.
- **Graph orchestrators are not delivery parents.** The async child-delivery hook ([ADR-0060](../adr/0060-async-subagent-delivery.md))
  skips a child whose parent is a graph session — heads are consumed by `awaitHead`, not the pump. This (plus
  the empty-drive no-op) is what stops a finished run re-driving itself.
- **Stop, break, and `continue`.** A run can pause without ending; `continue` resumes it wherever it is parked:
  - **Stop** pauses the running child sessions (`stopChild`) and ends the turn; the graph rides the pause.
    `sessions.stopTurn` delegates to `ctx.graph.stop` for a graph session. `continue` resumes the children.
  - **Break**: a node's `end` calls `ctx.break(message)` (throws `GraphBreak`) to reject its response (e.g. an
    empty required Select). The engine **parks** the run at that node — RunState stays alive, the message is
    posted, the turn ends (not an error). `continue` re-runs the parked node, re-surfacing the Select.
  - A finished run has no live state; `continue` then says "nothing to continue — send `start`".
- **The exit node** (owned by `BaseGraph`, reserved name, symmetric to `entry`) is reached by `{ goTo: "exit" }`.
  It renders its input as a fenced ` ```json ` block — the run's final chat output — then the engine settles.
- **The chart** is the normal transcript: each head (and the exit endpoint) opens a tool card on the
  orchestrator session linking its child, so the run reads as one chat with visible heads.

## Registration + launch

- Graphs are **code**, globbed at boot (`registerPluginGraphs()`, [plugins.md](plugins.md)) into the
  registry, id `<slug>:<file>`, gated by the owning plugin's enabled flag.
- `ctx.scan({ ignore, extensions })` walks the workspace via the List tool, never entering ignored dirs
  (`node_modules` &c.), keeping only supported extensions — for a scope picker.
- The **Flows** right-panel block lists each enabled graph as a launcher (`start`) + the active runs with
  stop/continue. A `needsWorkspace()` graph's launcher is hidden outside a workspace.
