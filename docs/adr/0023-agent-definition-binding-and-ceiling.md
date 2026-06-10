# ADR-0023: Agent definition — workspace binding toggle + per-agent tool ceiling

Status: accepted
Date: 2026-06-10

## Context

An agent (`core/agents.ts`) was name + description + system/user markdown plus
an output contract ("require JSON" + required keys). Three problems surfaced
when agents became runnable and orchestratable: (1) every agent silently
inherited whatever tools the launch context had — a summarizer spawned from a
workspace session got file access it never needed; (2) a "read-only reviewer"
was only a polite system-prompt request, unenforced; (3) the output contract
promised structure it didn't deliver (JSON.parse + key presence is not a
format), and neither real consumer wanted it — humans want prose, orchestrating
LLMs read text fine. Real schema contracts belong to the future pipeline that
consumes agent output programmatically.

## Decision

**`workspace: boolean` is a capability boundary, not a preference.** A
workspace agent runs bound to a workspace (the active one for manual runs, the
parent's for sub-agent runs) and gets that workspace's gated tools. A chat
agent ALWAYS runs unbound — even when launched from inside a workspace — so
file access never leaks in by launch context. Filtering follows in both
surfaces: the right-panel library hides workspace agents when no workspace is
selected, and the sub-agent catalog (ADR-0022) only offers what the parent
session's binding allows.

**`tools: Record<GatedTool, ToolMode>` is the agent's ceiling.** The effective
per-call mode is `min(workspace policy, agent ceiling)` — applied at both
checkpoints (advertising and execution) in the driver. An agent can restrict
what a workspace grants (the seed Code reviewer ships with
Write/Edit/CreateFolder/Bash at 0, making its read-only claim enforced fact)
but can never extend it. Defaults are all-auto: an unconfigured agent inherits
the workspace exactly. The ceiling is looked up live per turn step — editing an
agent affects the next step; a deleted agent degrades to plain workspace
policy. There is deliberately NO third permission surface beyond these two.

**The output contract is removed.** `Agent.output` / `buildValidator` and the
editor section are gone. The engine keeps the generic `validate` heal hook
(`opts.validate` on `sendTo`: any throwing function triggers bounded
re-prompting) — zero UI footprint, and the hook a future schema-based contract
plugs into.

## Consequences

- Capability attenuation composes: a workspace orchestrator can fan out to
  provably unprivileged chat workers, or to read-only workspace reviewers,
  while keeping write access itself.
- Workspace settings remain the single grant surface; the agent grid is purely
  subtractive, so reasoning about "what can this session touch" is
  `min(two known maps)` — no precedence rules.
- Sessions stamp `agentId`, so ceilings apply to manual runs, sub-agent runs,
  and follow-up turns alike.
- Anyone relying on the removed JSON checkbox must express the need in the
  agent's system prompt (unenforced) until a real schema contract exists.
- Stored agents normalize missing fields (`workspace` defaults false, ceiling
  defaults all-auto) — old libraries upgrade in place.
