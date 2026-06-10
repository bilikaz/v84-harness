# ADR-0022: Sub-agent orchestration — child sessions + the ListAgents/RunAgent pair

Status: accepted
Date: 2026-06-10

## Context

The agents library (`core/agents.ts`) always intended orchestration — the
`description` field existed "for the upcoming run-agent tool" — but no consumer
was ever built. An orchestrating model needs to discover available agents, run
several concurrently, and get their answers back, while the user needs to watch
what the workers are doing and stop everything from one place. Two design
pressures shaped the result: provider prompt caches hold only while the
advertised tool schemas stay byte-identical, and models (especially small ones)
are unreliable at emitting multiple parallel tool calls in one response.

## Decision

**Sub-agent runs are real sessions.** A `RunAgent` call spawns a child session
per run: `parentId` stamped, the parent's workspace and model config inherited,
never activated (focus stays on the parent chat). Everything existing then
works for free — streaming transcript, granular persistence (ADR-0021), stop
semantics (ADR-0014), the heal loop. Children render indented under their
parent in the sidebar and their `SessionView` is a **window, not a chat**: no
composer, no stop; control lives in the parent. Stopping the parent cascades
(`stopTurn` per child + queued-approval denial); deleting the parent
cascade-deletes its children.

**The tool pair is driver-level, not registry tools.** `ListAgents` and
`RunAgent` (`core/sessions/agentTools.ts` for schemas/catalog/resolution,
`execAgentTool` in the driver for execution) are dispatched before the
renderer/bridge paths — they spawn sessions, which only the driver can do, and
putting them in `core/tools` would cycle the import graph.

**The catalog is data, not schema.** Two stable schemas are advertised;
`ListAgents` returns the catalog (quoted name + description, filtered to the
session's context) as a tool *result*. Editing the library never mutates the
advertised tools mid-conversation, and the schemas stay cache-friendly. A
missed name self-heals: `RunAgent`'s error carries the valid names, so a blind
guess costs the same one step as listing first. Names resolve case-insensitively
after stripping quotes and trailing `[bracketed]` markers — models echo the
catalog's decoration around names (observed live).

**One call is the fan-out.** `RunAgent {runs: [{agent, task}, …]}` starts every
entry concurrently; the same agent may appear in several runs. Parallelism
never depends on the model emitting several tool calls per response. Per-run
failures report inline (numbered) without sinking the other runs. The combined
final answers return as the tool output (capped); the model never sees session
ids — the UI link rides separately (`tool:child` events live, `childSessionIds`
on the tool-result message durably) into the ToolCard's "view run" buttons.

**Depth 1.** Children are never advertised the pair (and run-time refuses it):
orchestrator → workers covers the use case; no runaway trees.

`Session.steps` (the never-implemented progress DAG) is deleted — the ToolCard
links plus live child sessions *are* the progress view.

## Consequences

- Sub-agent infrastructure reuses the session engine wholesale; the new code is
  one schema/catalog module, one driver handler, and UI affordances.
- The orchestrator's task must be self-contained (children can't see the parent
  conversation) — stated in the tool schema; quality depends on the model
  honoring it.
- Children inherit the parent's workspace permissions exactly (per-agent
  ceilings apply on top — ADR-0023); an `ask`-gated tool call inside a child
  pops the same global ApprovalModal.
- A reload mid-run loses only the transient half of the ToolCard links (the
  durable half lands with the tool result); the child sessions themselves are
  ordinary persisted sessions.
- The resolver's bracket-stripping means an agent literally named with a
  trailing `[…]` suffix can't be addressed — accepted, names are addresses.
