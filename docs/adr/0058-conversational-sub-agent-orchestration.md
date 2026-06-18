# ADR-0058: Conversational sub-agent orchestration — a standing, addressable team

Status: Accepted
Date: 2026-06-18
Supersedes/extends [ADR-0022](0022-subagent-orchestration.md) (fire-and-collect → a standing team). Builds on [ADR-0050](0050-engine-tool-tier.md) (the engine tool tier). The present-tense map is [architecture/agents.md](../architecture/agents.md).

## Context

ADR-0022 made sub-agent runs real child sessions, spawned and collected by `RunAgent` in one shot. That's
**fire-and-collect**: the parent gets each child's final answer once, then the handles are gone. Two costs
surfaced in use. First, a run that fails or times out (a long, prefill-bound run) is **stranded** — the
child session and its work persist on disk, but nothing can reach back into it, so the only recovery is
re-running from scratch and re-doing everything. Second, a child accumulates exactly the context the parent
would want to *reuse* (a sub-agent that explored a subsystem knows it), but there's no way to ask it a
follow-up — the knowledge dies with the one-shot answer.

## Decision

**Sub-agents are a standing team the orchestrator holds for the session**, not one-shot calls. The
child-sessions-are-real-sessions model, depth-1, batch-fan-out, and self-healing catalog from ADR-0022 all
stand; this adds addressing, conversation, and recovery on top.

- **Stored short aliases.** Each child gets a per-parent alias (`1`, `2`, `3`…) at spawn (`Session.alias`,
  persisted, assigned in `createSession`). The orchestrator addresses agents by it everywhere; ULIDs stay
  internal ([llm-interfaces.md](../conventions/llm-interfaces.md) rule 3 — the browser-fleet pattern, second instance).
- **Three new engine tools** join `ListAgents`/`RunAgent`: **`ActiveAgents`** (the live roster — alias,
  status, memory %, pure metadata, never the agents' responses), **`AskAgent`** `{runs:[{id, message}]}`
  (send a follow-up; the agent answers from its existing context), **`ResumeAgent`** `{runs:[{id}]}`
  (bare-continue a stalled run). All batch + lenient, all depth-1.
- **Typed outcomes.** A turn carries why it failed — `TurnResult.errorKind` / `Session.errorKind`, classified
  at the transport (`StreamEvent` error `kind`: `capacity` | `transport` | `other`). A failed run returns,
  *instead of an answer*, a breadcrumb naming the exact next call: transport → "`ResumeAgent {id}`" (resumable),
  **capacity** → "do NOT resume (it would re-fail); summarize via AskAgent or start fresh" — because resuming
  re-prefills the same oversized context. The roster's memory % is the warning; the OOM outcome is the event.
- **Resume continues from history, with no re-prompt.** `engine.resume(sid)` re-opens a stalled run from its
  existing history — drops the trailing errored `⚠️` turn so history ends at the gathered tool results, then
  re-runs the model step loop. No new user message: injecting one ("resume your work") makes the model answer
  *it* ("Understood") instead of finishing the task. `runTurn` was split into a shared `drive` body so both
  the normal path and resume run the same loop; the only difference is how the turn opens.

## Consequences

- A crashed/timed-out run is recoverable in one cheap call from its preserved state — the failure message is
  the recovery affordance, so the orchestrator (or the user) acts without deliberation.
- The orchestrator can delegate iteratively to agents that already hold relevant context, not just fan out once.
- Resume reuses the *work* but **re-prefills** the saved context — it doesn't shrink the prompt. Bounding
  context growth (so runs don't balloon in the first place) remains a separate, still-needed concern.
- ADR-0022's "per-run failures report inline (numbered)" is superseded by the typed-outcome breadcrumbs; its
  child-session reuse, depth-1, and one-call-fan-out clauses stand.
- `errorKind` is set on every errored turn (capacity from the transport, `other` for engine-side failures),
  cleared when a turn starts or resumes.
