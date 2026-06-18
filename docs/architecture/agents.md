# Agents

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Agents grew from a flat
"reusable playbook" library into a conversational orchestration layer; this is where that whole picture
lives. Decisions: [ADR-0022](../adr/0022-subagent-orchestration.md) (child sessions),
[ADR-0023](../adr/0023-agent-definition-binding-and-ceiling.md) (definition + ceiling),
[ADR-0050](../adr/0050-engine-tool-tier.md) (the engine tool tier),
[ADR-0058](../adr/0058-conversational-sub-agent-orchestration.md) (the standing team),
[ADR-0059](../adr/0059-builtin-general-agent.md) (the built-in General agent).

## What an agent is

A stored **definition** (`core/agents.ts`, an `Agent`): `name` (its address), `description` (the
orchestrator-facing contract), `system` (baked instructions), `user` (default task template), `workspace`
(needs-a-workspace toggle), and `tools` (a per-agent permission **ceiling**, `AgentTools`). Agents are rows
in the active provider's `agents` store (a reactive `Consumer`). A run is a real **session** stamped with the
agent's `agentId` — so the agent's output contract and ceiling apply to every turn of that run.

## Running agents as a team (the engine tool tier)

The orchestration tools live in `core/tools/engine/agents/` — driver-level tools ([ADR-0050](../adr/0050-engine-tool-tier.md)),
not registry tools, because they need the live engine to spawn/continue sessions. `catalog.ts` holds the
shared schemas + helpers; one file per tool. All are **depth-1** (`childSafe = false`) — a sub-agent can't
orchestrate its own team. The five:

| Tool | Shape | Role |
|------|-------|------|
| `ListAgents` | `{}` | The catalog (names + descriptions) as a tool *result* — not baked into schemas ([llm-interfaces.md](../conventions/llm-interfaces.md) rule 1). |
| `RunAgent` | `{runs:[{agent, task}]}` | Spawn agents as concurrent child sessions; one call fans out (rule 2). |
| `ActiveAgents` | `{}` | The live roster: each running agent's short id, status, memory %. |
| `AskAgent` | `{runs:[{id, message}]}` | Send a follow-up to a running agent — it answers from its existing context. |
| `ResumeAgent` | `{runs:[{id}]}` | Bare-continue a crashed/stalled run — no message (see Resume). |

`RunAgent`/`ListAgents` are advertised whenever the catalog is non-empty (always — see General agent below);
`ActiveAgents`/`AskAgent`/`ResumeAgent` advertise only once the session has children to address.

## Addressing: stored short aliases

Sub-agents are addressed by a **stored per-parent alias** (`1`, `2`, `3`…), assigned at spawn in
`createSession` (`Session.alias`, persisted) and resolved leniently (`resolveChild`, strips quotes/spaces; a
bad id returns the roster inline). ULIDs never reach the model — they're hallucination bait
([llm-interfaces.md](../conventions/llm-interfaces.md) rule 3, same pattern as browser-window aliases).
Replies are tagged `agent (id: N): …`.

## The roster (`ActiveAgents`)

Pure **metadata**, never the agents' responses (those are already in the orchestrator's transcript; echoing
them would duplicate and bloat). Per agent: alias, name, **status** (`working` while streaming, `out of
memory`/`failed` from a stored `errorKind`, else `idle`), and **memory %** — context occupancy
(`usedTokens / contextLimit`), the warning before an agent overflows.

## Typed outcomes (recovery is named, not guessed)

A turn carries why it failed: `TurnResult.errorKind` / `Session.errorKind`, classified at the transport
(`StreamEvent` error `kind`) as **capacity** (context full / OOM), **transport** (connection lost, retries
exhausted), or **other**. A failed run returns — *instead of an answer* — a `failureNote` that names the
exact next call:

- **transport/other** → "lost connection … `ResumeAgent {"runs":[{"id":N}]}`" — resumable.
- **capacity** → "ran out of memory … do NOT ResumeAgent it (it would re-fail); summarize via `AskAgent` or
  start fresh via `RunAgent`." Continuing would re-prefill the same oversized context.

## Resume: continue from history, no re-prompt

`engine.resume(sid)` re-opens a stalled run from its **existing history** with no new user message (drops the
trailing errored `⚠️` assistant via `store.resumeTail`, re-runs the model **step loop** from the gathered
tool results). The model finishes the task instead of answering a re-prompt (which would just return
"Understood"). `runTurn` and `resume` share one `drive` body — the only difference is how the turn opens
(push user turn vs re-open the tail).

## Capability inheritance & the built-in General agent

A child's capability is `capabilityContext(session)`: its agent's `workspace` flag + ceiling over its
container's policy — children inherit the parent's workspace, masked by the agent's ceiling
([ADR-0023](../adr/0023-agent-definition-binding-and-ceiling.md)).

The **General agent** ([ADR-0059](../adr/0059-builtin-general-agent.md)) is a built-in catalog entry
(`id: "general"`, empty `system`, empty `tools`), injected unless the user defines their own by that name. It
inherits the caller's context *for free*: spawned into the parent's container, and because `getAgent("general")`
is undefined, `capabilityContext` is container-driven — workspace file tools when there's a workspace, the
live base system either way. So an orchestrator can always summon a general-purpose helper that runs with
exactly its own tools.

## Lifetime & UI

Children are real sessions ([ADR-0022](../adr/0022-subagent-orchestration.md)): persisted, streamed, stop/heal
for free, rendered as read-only windows under the parent (control lives in the parent — stopping cascades,
deleting cascade-deletes). The roster is the parent's children for the life of the session.
