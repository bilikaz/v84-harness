# ADR-0070: Agent tool grounding via a `*` wildcard ceiling

Status: Accepted
Date: 2026-06-29
Refines the tool permission policy ([ADR-0007](0007-tool-system.md)) and the agent ceiling
([ADR-0023](0023-agent-definition-binding-and-ceiling.md), [ADR-0068](0068-plugin-agents-code-registry.md)).
Present-tense map: [architecture/graph.md](../architecture/graph.md), [architecture/tools.md](../architecture/tools.md).

## Context

An agent's `tools` map (`AgentTools`) is a per-tool **ceiling**: the advertisement filter computes
`effectiveMode = min(workspaceMode, agentCeiling)`, and an unlisted tool defaulted to ceiling `2` (allow). So
the map read like an allowlist but behaved as a permissive default: a graph head with `{ Read, Find, Grep, List }`
still inherited the workspace's full toolset (Fetch, SaveMemory, …), and the review consolidator with `tools: {}`
got **everything**. Heads wandered off-task — fetching, saving memory — instead of doing their one job.

## Decision

**The agent ceiling falls back to a reserved `*` wildcard before the default.** In the filter:
`agentCeiling = agentPermissions[name] ?? agentPermissions["*"] ?? 2`. An agent **grounds** itself by setting
`"*": 0` plus an explicit allowlist:

- `{ "*": 0, Read: 2, Find: 2, Grep: 2, List: 2 }` → exactly those four tools; everything else disabled.
- `{ "*": 0 }` → zero tools (the consolidator).
- `{ "*": 1 }` → ask for everything unlisted; `{ "*": 2 }` (or no wildcard) → the prior inherit-all default.
- Explicit entries always beat the wildcard, so `{ "*": 2, Fetch: 0 }` is a denylist.

The wildcard is a **ceiling**, not a force-on: `min(workspace, ceiling)` still holds, so `"*": 2` cannot grant a
tool the workspace blocks. Mode-0 tools are dropped from the advertised set (not just permission-gated), so a
grounded head never even *sees* the excluded tools. The review plugin's agents are grounded accordingly
(reviewers/verifier to the four read tools, consolidator to none).

## Consequences

- Agents (graph heads especially) stay on-task — a head's tool surface is exactly what its job needs.
- One mechanism covers allowlist (`"*": 0` + grants), denylist (`"*": 2` + blocks), and "ask for the rest"
  (`"*": 1`) — a single default-ceiling knob.
- The wildcard is invisible to the Agent editor (it iterates the real tool registry, keyed by tool name), so a
  `*` entry never renders as a phantom tool row. A future nicety is surfacing a "ground to listed only" toggle
  there; today the wildcard is authored in `agents.json` / agent rows directly.
- Behaviour is backward compatible: agents without a `*` entry keep the inherit-all default.
