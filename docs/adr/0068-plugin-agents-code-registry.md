# ADR-0068: Plugin agents as a runtime-gated code registry

Status: Accepted
Date: 2026-06-28
Refines the agents model ([ADR-0058](0058-conversational-sub-agent-orchestration.md)) and the plugin model
([ADR-0047](0047-first-party-in-tree-plugins.md)) — plugin-provided agents follow the same "globbed, gated at
runtime" rule as plugin tools/UI. Relates to [ADR-0067](0067-graph-orchestration-engine.md) (graphs reference
these agents). Present-tense map: [architecture/graph.md](../architecture/graph.md), [architecture/plugins.md](../architecture/plugins.md).

## Context

A plugin ships agents (the code-review reviewers). The first design **materialized** `plugins/<slug>/agents.json`
into the user's agents store (upsert-if-absent). In practice that failed three ways at once: a **disabled**
plugin's agents still polluted the Agents list; an **id rename** left the old rows as duplicates; and edits to
`agents.json` **never reached** already-seeded rows (seed-once never updates). It was the one plugin
contribution that wasn't runtime-gated like the rest.

## Decision

**Plugin agents are code in a runtime-gated registry, not rows in the user store.** `registerPluginAgents()`
globs `plugins/<slug>/agents.json` at boot, tags each with its `ownerPluginId`, and registers it in an
in-memory registry (`core/agents.ts`). `getAgent` resolves the user store first, then the registry, so a graph
can reference its plugin's agents by id. The Agents panel shows them **only while the owning plugin is
enabled** (the same gate as the plugin's tools/UI). `agents.json` is the single source of truth.

`hydrateAgents` **prunes** any rows an earlier materializing build seeded (ids prefixed `<slug>:`), so existing
profiles self-heal.

## Consequences

- Edits to `agents.json` take effect on next boot; renames don't orphan; a disabled plugin contributes
  nothing; no sync duplication. None of the materialize hazards remain.
- The cost: plugin agents are **not user-editable** (they're code) — acceptable, and consistent with how
  plugin tools/UI work. A user who wants to customize would fork into their own agent.
- Plugin agents stay **out of the orchestrator catalog** (`getAgents`/`ListAgents`) — they're internal to
  their graph, resolved by id, not offered as general sub-agents.
