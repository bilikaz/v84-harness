# ADR-0083: The agent tools ceiling binds EVERY tool tier

Status: Accepted
Date: 2026-07-09
Amends the grounding wildcard of [ADR-0050](0050-engine-tool-tier.md)-era filtering.
Present-tense map: [architecture/tools.md](../architecture/tools.md),
[architecture/agents.md](../architecture/agents.md).

## Context

Agent grounding (`{"*": 0, Tool: 2}`) clamped only PERMISSIONED tools: the registry's ceiling check
sat inside `if (permissioned)`, and the driver-level engine tier joined the advertised set after
the policy pass. A grounded comics head, refused by its budgeted tool after a restart, walked
around its entire flow through plain `ImageGenerate` — permissionless, always advertised, invisible
to the permissions UI. The original regression test only built permissioned tools, so "grounding
works" was true and worthless.

## Decision

**The agent ceiling is a statement about the AGENT, orthogonal to the workspace policy — it binds
every tool:**

- In `registry.filter()`, `effectiveMode` STARTS from the agent ceiling
  (`agentPermissions[name] ?? agentPermissions["*"] ?? 2`); the workspace grant then only tightens
  permissioned tools (stricter of grant and ceiling).
- The engine tier (sub-agent pair, browser fleet) filters through the same ceiling before joining
  the advertised set.
- The regression suite includes a permissionless tool: `{"*": 0}` advertises NOTHING.
- Related agent-registry hardening: the permissions panel resolves plugin agents (same lookup as
  the engine — no false "agent no longer exists"), and plugin agents appear in the Agents catalog
  only when their `agents.json` entry declares `"listed": true` (default hidden: cycle workers of a
  flow are not user-facing agents).

## Consequences

- "Structurally cannot" is now true: a validator agent grounded without generate tools cannot
  generate, on any tier, in any session state.
- A plugin shipping ten internal agents adds zero catalog noise; opting one in is a one-key
  declaration.
