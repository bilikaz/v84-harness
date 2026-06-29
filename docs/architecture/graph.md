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
- `{ done }` — terminal; the text is the graph's final message.

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
is live tracking for the chart + stop/continue.) There is **no persistence blob** — only the router needs
memory, and only for the join. A full app restart mid-run therefore does not resume (in-session stop/continue
does).

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
`requestSelect`/`resolveSelect`/`cancelSelectsForSession`); `pattern` is graph-provided; `ai` is a placeholder.
`view: list | tree` is a renderer hint over the same `{ id, selected[] }` result: `list` is single/multi;
`tree` renders nested `options.children` as a cascading checkbox tree (checking a parent checks all
descendants, indeterminate for partial) — used by the scope folder picker.

## The seam, stop/continue, the chart

- **The seam**: the sessions turn loop's `drive()` branches on `session.graphId` → `ctx.graph.run(sid)` (used
  by resume); `start()` calls `run()` directly. That one branch is the whole core extension; everything
  downstream (transcript via the bus, persistence at turn end, the sidebar) is reused.
- **Stop / Continue act only on the children.** Stop pauses the running child sessions (`stopChild`); the
  graph is untouched — its `awaitSettled` *rides* the pause, so nothing advances. `sessions.stopTurn`
  delegates to `ctx.graph.stop` for a graph session. Continue resumes the children; each one finishing fires
  its `end` and the flow proceeds. No graph restart.
- **The chart** is the normal transcript: each head opens a tool card on the orchestrator session linking its
  child, so the run reads as one chat with visible heads.

## Registration + launch

- Graphs are **code**, globbed at boot (`registerPluginGraphs()`, [plugins.md](plugins.md)) into the
  registry, id `<slug>:<file>`, gated by the owning plugin's enabled flag.
- `ctx.scan({ ignore, extensions })` walks the workspace via the List tool, never entering ignored dirs
  (`node_modules` &c.), keeping only supported extensions — for a scope picker.
- The **Flows** right-panel block lists each enabled graph as a launcher (`start`) + the active runs with
  stop/continue. A `needsWorkspace()` graph's launcher is hidden outside a workspace.
