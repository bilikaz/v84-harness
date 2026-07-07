# ADR-0073: Sub-agent restart recovery — the `delivered` watermark + boot reconcile

Status: Accepted
Date: 2026-06-30
Builds on async sub-agent delivery ([ADR-0060](0060-async-subagent-delivery.md)) and incremental
persistence ([ADR-0072](0072-commit-on-landing.md)). Present-tense map:
[architecture/sessions.md](../architecture/sessions.md), [architecture/agents.md](../architecture/agents.md).

## Context

Async sub-agent delivery ([ADR-0060](0060-async-subagent-delivery.md)) is **in-memory only**: the
per-parent delivery queue and the `awaitSettled` subscriptions don't survive a reload. Before
[ADR-0072](0072-commit-on-landing.md) nothing in-flight was durable anyway, so a restart mid-run simply
lost the orchestration. Now the parent's spawn call + ack and the child sessions ARE durable, so a restart
*can* recover — but the engine must know which children are still owed a delivery to the parent.

## Decision

**A durable per-child `delivered` watermark, plus a boot `reconcile()` that resumes the rest.**

- `delivered` (false while a turn's result is owed to the parent, true once it has landed in the parent's
  transcript) lives in `session.meta` ([ADR-0074](0074-session-identity-vs-runtime.md)). Reset when the
  child starts a fresh turn; set the moment the result reaches the parent — the synthetic delivery
  (`engine.deliver`) and the model-initiated read (`GetAgentContent`).
- **Why a flag, not inferring from `childSessionIds`:** that field rides three structurally-identical
  results — an async spawn ack (children *started*, NOT delivered), an async `getAgentContent` delivery
  (delivered), and a sync `RunAgent` result (delivered). Presence can't tell delivered from spawned, and
  it differs by `asyncAgents`. An explicit flag is unambiguous.
- **Boot `reconcile()`** (async runs only — sync runs block the parent turn, nothing to re-pump) walks
  each parent's children: of those its committed history knows about (a `childSessionIds` on a spawn ack /
  prior delivery), the **undelivered** ones are **settled** (last committed message is a final answer, or
  `errorKind` set) → re-enqueue for delivery, else → `resume()` the child (its `turn:end` then delivers).
- **Content is never duplicated into the parent.** `collectAgentContent` always reads it from the child's
  own transcript; the parent head holds only the spawn link + the delivery watermark.

## Consequences

- A mid-run restart continues the orchestration instead of stranding it; the parent wakes when its
  children's results are (re-)delivered, exactly as in steady state.
- A **sync** mid-block crash loses the parent turn (its `RunAgent` result never committed) but the child
  sessions survive — graceful, not corrupt; reconcile skips them (no committed spawn link references them).
- Reconcile **auto-fires LLM calls on boot** to continue interrupted async runs — intended, but it means
  launch can resume model work.
- **Out of scope:** a user-paused child across restart — `userPaused` is transient, so on boot it reads as
  unfinished and reconcile would resume it. A durable pause flag is deferred.
- **Async is the default** (`asyncAgents: true`): async is the only mode that recovers a mid-run restart
  (the sync mid-block crash above strands the parent turn), so the recoverable path is the default. Sync
  remains available for simple blocking delegation. The async orchestration prompts (`prompts.ts` `agents.async`)
  name all delegation verbs (Run/Ask/Resume) and tell an idle orchestrator to END ITS TURN rather than poll —
  so it yields and the delivery notice wakes it, instead of busy-waiting on ActiveAgents.
