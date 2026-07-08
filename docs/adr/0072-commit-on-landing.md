# ADR-0072: Incremental message persistence — commit on landing

Status: Accepted
Date: 2026-06-30
Supersedes [ADR-0020](0020-persist-at-turn-completion.md) (persist at turn completion only).
Amended by [ADR-0078](0078-compaction-as-send-boundary.md): compaction now appends instead of
rewriting, so `replaceForSession` survives only for the offline-delete clear.
Builds on the per-entity repos ([ADR-0043](0043-per-entity-repos.md)). Present-tense map:
[architecture/storage.md](../architecture/storage.md), [architecture/sessions.md](../architecture/sessions.md).

## Context

[ADR-0020](0020-persist-at-turn-completion.md) wrote a session's whole transcript once, at `turn:end`.
That was right when a persist was a multi-MB `JSON.stringify` of the entire profile — writing more often
froze the window. Per-entity rows ([ADR-0043](0043-per-entity-repos.md)) changed the cost: a write is now
one small message row. Turn-end-only then has two costs of its own: a crash mid-turn loses the whole
in-flight turn (the user's message **and** the partial response), and an in-flight sub-agent/graph run is
not durable at all, so it can't survive a restart ([ADR-0073](0073-subagent-restart-recovery.md)).

## Decision

**A message becomes durable the moment it is finalized — append-only of the new rows, never a
whole-transcript rewrite.** `commitMessages(sid)` writes the trailing run of not-yet-persisted messages,
fired on `turn:start` / `tool:result` / `turn:deliver` / `turn:end`.

- **Commit points:** the user message at `turn:start`; a **complete tool exchange** (the assistant + ALL
  its tool results) once every call has a result; the final answer at `turn:end` when not errored/aborted.
- **Never half an exchange.** A tool-call assistant is held until its results land — a committed
  `tool_call` with no matching result (or an orphan result) is malformed history a provider rejects next
  turn. This also subsumes the erased premature `getAgentContent`: it never gets a result, so it never
  commits.
- **Turn-scratch is never written.** The malformed assistant + heal correction (kept in memory so the
  model sees its mistake + the fix), the `⚠️` error tail, and aborted partials are flagged never-persist.
  Because they were never written, `removeToolCall` / `resumeTail` / heal need **no durable delete** —
  they stay pure in-memory turn mechanics.
- **Send only the new.** A transient committed-id set is the boundary (ids claimed synchronously against
  double-sends). The durable surface is `messages.put` (upsert by id) + `remove`; `replaceForSession` is
  demoted to the compaction/reset path. Same surface on every backend and a new `PUT`/`DELETE
  /messages/:id` on the knowledge API.
- **ULID message ids** ([constants-and-identifiers](../conventions/constants-and-identifiers.md) rule 4)
  so reload order = creation order on every backend (IDB index `getAll`, SQLite/remote `ORDER BY`),
  now that incremental append — not a whole-array rewrite — re-imposes order.

The freeze rationale of ADR-0020 **survives**: still **no per-stream-delta writes** — a streaming
assistant commits once, when complete.

## Consequences

- A crash loses at most the one actively-streaming message, not the whole turn.
- In-flight `RunAgent`/graph spawns are durable, which is what makes restart recovery possible
  ([ADR-0073](0073-subagent-restart-recovery.md)).
- Don't re-add a `turn:end` whole-transcript persist — that's the write this ADR removes.
- `replaceForSession` still exists for the one genuine wholesale rewrite (compaction replacing the
  transcript with a summary) and the offline delete-clear.
