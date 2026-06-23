# ADR-0060: Async sub-agent orchestration & the settle-event delivery model

Status: Accepted
Date: 2026-06-23
Extends [ADR-0058](0058-conversational-sub-agent-orchestration.md) (the standing team) and
[ADR-0050](0050-engine-tool-tier.md) (the engine tool tier). Interacts with
[ADR-0014](0014-stop-semantics-and-tool-cancellation.md) (stop semantics). Present-tense map:
[architecture/agents.md](../architecture/agents.md).

## Context

ADR-0058 gave the orchestrator a standing, addressable team, but dispatch stayed **blocking**:
`RunAgent`/`AskAgent`/`ResumeAgent` each `await`ed every child's turn inline and returned the answers in the
tool result. Two costs surfaced:

1. **The parent is frozen while children work.** A fan-out of long, prefill-bound runs holds the parent's
   turn open until the slowest finishes; it can't react to early finishers, interleave its own work, or be
   handed results as they land.
2. **Inline `await` is wrong once children are user-drivable.** A child run is a real session the user can
   open and **stop** mid-flight (to guide it). The raw turn Promise resolves on the *first* abort — so a user
   *pause* surfaces to the parent as a hard "stopped", leaking exactly the intervention churn that should stay
   invisible. The Promise also can't ride a pause→guide→resume cycle: whoever resumes the child (the user, via
   its composer) starts a new turn the parent's `await` never sees.

## Decision

**One delivery signal — a child's terminal, non-aborted `turn:end` — consumed by two transports.** A user
pause/abort is *not* a delivery; only a real success or error is.

- **`session.asyncAgents` toggle** (default off; the classic await-all stays the default). When on, the three
  orchestration tools return an **ack immediately** and never block the dispatch turn.
- **Async transport = push.** When a child settles, the engine queues it per-parent and, on the parent's next
  *idle* moment (never mid-print), pushes the result as a wake-turn. Two delivery shapes, `session.asyncDelivery`:
  **`nudge`** (default) injects a runtime notice and lets the model call `getAgentContent`; **`synthetic`**
  fabricates a `getAgentContent` call + result straight into history so the model wakes having "received" it
  with no extra round-trip (falls back to `nudge` if the provider rejects the fabricated history).
- **Sync transport = block on the settle EVENT, not the turn Promise.** `engine.awaitSettled(childSid, signal,
  dispatch)` resolves only on the child's first non-aborted `turn:end` (a pause is ignored → keep waiting), then
  reads the final text from history. The `dispatch` Promise is a liveness guard (a refused/never-started turn
  resolves `null` so it can't hang). A pause→guide→resume is now invisible to the parent — it receives the
  *final* result, and the user can improve a child mid-task.
- **`getAgentContent {ids:[…]}`** — the read tool the orchestrator uses to pull finished children's output by
  short id. Calling it on a **still-pending** child **erases its own call** from history (`EngineToolResult.
  eraseTurn` → `store.removeToolCall`) and ends the turn cleanly: don't poll, you'll be told.
- **User-drivable children.** A per-child stop is a **pause, not a failure**: `engine.stopChild` marks the
  child user-paused (`store.userPausedIds`, cleared when it next streams) and aborts its turn. Resume ownership
  follows the stopper — the parent's `ResumeAgent` refuses a user-paused child (it's the user's to continue);
  the roster/`getAgentContent` treat user-paused as "not done". The parent is never told about the pause.
- **Shared dispatch (`fanOut`).** The three tools share one dispatch/format loop (`tools/helpers/agents/
  fanout.ts`): each tool is reduced to a per-run **planner** (resolve + start one child, returning
  `{childSid, alias, name, dispatch}` or `{error}`) plus an ack **verb**. `fanOut` owns the sync/async branch,
  abort wiring, outcome/ack formatting, and the `childSessionIds` result.

## Consequences

- The orchestrator stays live during fan-out: it acks, keeps working, and is handed each result as it lands —
  or, in sync mode, blocks only on the genuine final answer.
- Sync orchestration is now correct under stop/resume; pausing a child to guide it no longer corrupts the
  parent's view, and the parent benefits from the user's intervention.
- Exactly one delivery route is live per mode (async push *or* sync `awaitSettled`), so there is no
  double-delivery — the earlier `inlineChildren` suppression flag was removed as unreachable.
- One output convention across all three tools; a fourth orchestration tool is a planner + a verb.
- Synthetic delivery fabricates assistant history — validate on the live endpoint before making it the default
  (kept at `nudge` until then).
- **Orthogonal and still open:** none of this bounds a child's context. Long/resumed runs still re-prefill and
  can be evicted by a local LLM's KV cache under concurrency — see [/TODO.md](../../TODO.md) "Local-LLM
  prefill/eviction kills long & resumed runs".
