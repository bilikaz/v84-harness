# ADR-0050: Engine tool tier — driver-level tools as a discovered, gated tier

Status: Accepted
Date: 2026-06-17
Amends [ADR-0022](0022-subagent-orchestration.md) (the sub-agent pair is now an engine tool); builds on [ADR-0033](0033-tools-registry-folder-by-permission.md) and [ADR-0048](0048-tool-ctx-config-carrier.md) (the registry's config-only contract) and [ADR-0032](0032-ctx-main-data-carrier.md) (`ctx`).

## Context

Two tool families need the **live engine/ctx**, not just config: the sub-agent pair
(`ListAgents`/`RunAgent`, [ADR-0022](0022-subagent-orchestration.md)) needs the session spawner; the
browser-fleet tools need the live `browserFleet()`. The registry contract ([ADR-0048](0048-tool-ctx-config-carrier.md))
constructs a `BaseTool` with **only** a `() => Config` getter — so neither can be a registry tool.

They were dispatched ad-hoc in the turn loop: `if (name === LIST_AGENTS || name === RUN_AGENT) …` and
`if (isBrowserTool(name)) …`, each handled **before** the registry/policy path. Two costs: every such
family bypassed the permission policy entirely (no gate at all), and the turn loop grew a hardcoded `if`
arm per family.

## Decision

A third tool category — the **engine tier** (`core/tools/engine/`) — for tools that depend on the live
engine/ctx rather than config.

- **Contract** (`base.ts`): `BaseEngineTool` with `schema`, `available(ec)` (advertisement gate),
  `defaultPermission()`, `childSafe` (top-level only by default), and `run(call, ec)`. `ec` (`EngineCtx`)
  is built per call by the turn loop: `{ ctx, sessionId, workspace, signal, isChild, engine }`.
- **Discovery + dispatch** (`dispatch.ts`): an eager glob of `./*/*.ts` (one folder per family — `agents/`,
  `browser/`) instantiates the concrete subclasses, exactly as the registry does. `engineToolSchemas(ec)`
  advertises the `available` tools in stable name order; `runEngineTool(call, ec)` is the **single** gated
  path — child guard, then `defaultPermission()` (mode 1 → `requestApproval`), then `run`. The engine emits
  the `tool:result` and feeds any returned images to the vision step.
- **No per-folder service.** The plugin folder layout is the structural template *only* — engine tools own
  no `service.ts`; their "service" is the engine/ctx, handed in via `ec` (e.g. `RunAgent` spawns through
  `ec.engine.runAgent`).

Why not widen the registry contract: the config-only constructor ([ADR-0048](0048-tool-ctx-config-carrier.md))
is deliberate; carrying the fleet/engine into every tool would dilute it. Why not keep the ad-hoc arms:
each bypassed gating and the chain grew per family.

The glob lives in `dispatch.ts`, **not** the contract file `base.ts`: Vite compiles eager
`import.meta.glob` to static imports hoisted above class declarations, so globbing inside `base.ts` imports
the tool files before `BaseEngineTool` is defined — a "class extends undefined" cycle. This is the same
reason the registry globs in platform init, not in `registry.ts`.

## Consequences

- One home for engine-coupled tools; a new one is a file in a folder — no turn-loop `if`-chain growth.
- Driver-level tools are **finally permission-gated** in one place (e.g. `Browser` → ask), closing the
  seam where they bypassed policy.
- The sub-agent pair relocated here (`execAgentTool`'s body moved verbatim into `RunAgent`); the browser
  tools too. `core/browserTools.ts` and `core/sessions/agentTools.ts` are deleted. The sub-agent
  session-spawn tests are the gate that the relocation stayed faithful.
- Engine-tier gating honors `defaultPermission()` directly; these tools are **not** in the per-workspace/
  agent permission UI (the registry's policy machinery doesn't see them). Acceptable for now — revisit if
  per-tool configurability is wanted.
- Sub-agent depth-1 ([ADR-0022](0022-subagent-orchestration.md)) is enforced by `childSafe = false` + the
  dispatcher's child guard, replacing the old per-arm `isChild` checks.
