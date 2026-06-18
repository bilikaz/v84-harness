# ADR-0059: Built-in universal General agent — always summonable, inherits the caller's context

Status: Accepted
Date: 2026-06-18
Builds on [ADR-0058](0058-conversational-sub-agent-orchestration.md) (orchestration) and [ADR-0023](0023-agent-definition-binding-and-ceiling.md) (capability inheritance). Map: [architecture/agents.md](../architecture/agents.md).

## Context

Orchestration is only useful if there's something to orchestrate, but a fresh install (or any session whose
user never authored agents) has an empty catalog — so `RunAgent` isn't advertised and the model can't
delegate at all. We want an orchestrator to be able to summon a general-purpose helper **at any time** with
no setup, and that helper should run with the **same tools and base system as the caller** (so delegating to
it is like spinning up another instance of the current workspace/chat), with the task as its only input.

## Decision

**Hardcode a built-in "General agent" in the catalog**, injected unless the user already defined one by that
name (theirs wins, no clash). It is `{ id: "general", name: "General agent", system: "", tools: {} }`.

It inherits the caller's context **with no special-casing**, by leaning on the existing capability machinery:

- **Empty `system`** → the engine resolves the base live (workspace → global → default,
  [ADR-0052](0052-system-prompt-layering.md)), so it runs under the same system as the caller.
- **Empty `tools` ceiling** → no restriction → the child runs at the full workspace policy.
- **`getAgent("general")` is undefined** (it's built-in, not a stored row), so `capabilityContext` is driven
  entirely by the child's **container** — and `RunAgent` spawns children into the parent's container. Result:
  workspace file tools when the parent is in a workspace, a plain chat helper otherwise — automatically.

The `workspace` flag on the catalog entry just mirrors the context so it lists in both chat and workspace.

## Consequences

- An orchestrator can always delegate ad-hoc work; `RunAgent`/`ListAgents` are now advertised in every
  top-level session (the catalog is never empty).
- The General agent needs zero config and stays correct as the base-system layering or workspace policy
  changes — it reads them live rather than baking a copy.
- A user who wants a *different* general-purpose default just creates an agent named "General agent"; the
  built-in steps aside.
- It's still depth-1: a General-agent child can't summon its own team.
