# ADR-0067: Graph orchestration engine — event-driven named-node graphs

Status: Accepted
Date: 2026-06-28
Adds a second orchestration mode alongside ReAct sub-agents ([ADR-0022](0022-subagent-orchestration.md) /
[ADR-0058](0058-conversational-sub-agent-orchestration.md) / [ADR-0060](0060-async-subagent-delivery.md)).
Reuses the sessions turn loop ([ADR-0019](0019-reference-stable-transcript.md)/[ADR-0020](0020-persist-at-turn-completion.md)),
the approval Promise bridge ([ADR-0013](0013-approval-promise-bridge.md)), and composer priming
([ADR-0024](0024-agent-runs-through-composer.md)). Distinct from the concurrency runner
([ADR-0066](0066-concurrency-runner.md)). Present-tense map: [architecture/graph.md](../architecture/graph.md).

## Context

Some work is a fixed process, not a free-form chat: a code review is scope → fan out reviewers → verify →
consolidate. Driving that through a ReAct agent means the model re-derives the process every run, can skip
steps, and gives no deterministic control points (which milestone is running, where to stop/resume). We want
**deterministic orchestration** where the steps are explicit, but still able to call the model where judgement
is needed, and to present as one ordinary chat.

A first design used a polling loop that re-scanned the transcript each tick to infer position; it conflated
"a fan-out started" with "it finished," lost in-flight results on Stop, and read as transcript archaeology.
That was rejected during this session in favour of the event-driven model below.

## Decision

**A graph is plugin code — an `entry` node + a registry of named `Start`/`End` nodes — driven event-by-event
by a core `GraphEngine` (`ctx.graph`, `core/graph/`).** A graph run is a real session stamped `graphId`; the
sessions turn loop's `drive()` branches on `graphId` → `ctx.graph.run(sid)` (the only core extension).

- **Node = `start`/`end` pair.** `start(ctx, input)` returns a `NodeAction` — `{ modal }` (a Select),
  `{ agent }` (spawn a child head), or `{ value }` (sync). When that work completes the engine calls
  `end(ctx, input, response)` — which has **both** the input the head started with and the result — returning
  a `Route`: `goTo` (solo), `splitTo` (fan out a new sibling group), `goToAll` (join), or `done`.
- **Data flows by passing, never by reading.** A node never reads another node's data; `end` composes the next
  `input` from its `input`+`response`. There is no shared blackboard and no persisted graph state.
- **Joins are producer-declared and arrival-driven.** A join node declares nothing; the *finishing* head names
  the wait via `goToAll` (it knows its fan-out group), and the engine fires the join once **arrivals reach the
  group size** — counted, never liveness-polled (a head between stages is idle-but-not-done, so polling would
  fire early). The group propagates through `goTo`; `splitTo` mints a fresh one.
- **The runner's only storage is the join buckets.** The per-session run state (in memory, keyed by sid) holds
  the `goToAll` arrival buckets — the one thing the router must accumulate — plus live `running` tracking for
  the chart/stop. No persistence blob.
- **Stop/Continue act only on the children.** Stop pauses the running child sessions (`stopChild`); the graph
  is untouched (its `awaitSettled` rides the pause); `sessions.stopTurn` delegates to `ctx.graph.stop` for a
  graph session. Continue resumes the children; each finishing fires its `end`.
- **Heads** are seeded sub-agent runs; `AgentSpec.seedFiles` seeds the opening with **real** `Read`
  calls+results (priming extended to carry tool calls). `awaitHead` enforces the JSON contract — it **extracts
  the JSON** from a prose-wrapped reply and forwards the clean JSON; on mismatch it heals — **unparseable →
  bare resume** (`resumeTail` drops the broken reply; it is **never re-sent**, because the provider's renderer
  `json.loads` message content and 400s on broken JSON); **missing fields → targeted correction** (valid JSON,
  safe to re-send); an **errored** turn bails. `ok` means settled **and** valid; a failed head forwards `""`,
  never the error.
- **The Select primitive** (`core/graph/select.ts`) is one artifact (`{ id, selected[] }`) resolved by source
  (`user` via the SelectModal Promise bridge / `pattern` / `ai`), with a `list | tree` renderer hint (the tree
  cascades parent→children). Usable by graphs and by plain agents.

## Consequences

- A fixed process is expressed as explicit milestones with deterministic control points; the run is one
  visible chat (each head a linked child), with Stop/Continue free for every graph.
- The engine is generic; graphs are an open set of plugin contributions (the code-review plugin is the first;
  a task→code pipeline is the intended next).
- **No cross-restart resume**: the join buckets live only in memory by design, so a full app restart mid-run
  does not resume (in-session stop/continue does). Reconstructing run state from the child sessions on restart
  is a possible later slice.
- `ai`-source Select is a placeholder (first option) until model-consulted resolution lands.
