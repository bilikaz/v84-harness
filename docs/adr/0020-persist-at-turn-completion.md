# ADR-0020: Persistence at turn completion only

Status: accepted
Date: 2026-06-10

## Context

`persist()` is a synchronous whole-profile write: `JSON.stringify` of every
session (media data-URLs included — tens of MB on real profiles) plus an IPC
ship to the durable tier. It ran at `turn:start` *and* `turn:end`, so starting
any turn — including regenerating on a heavy profile — froze the window before
the first token arrived. The localStorage first-paint cache made it worse by
attempting (and failing) a multi-MB `setItem` on every persist once the
payload outgrew the ~5 MB quota.

## Decision

**State becomes durable when a turn completes, not while it runs.**

- The turn's session is persisted at `turn:end` (and discrete session
  mutations persist what they touched: create/delete/rename the index,
  compaction its session) — never at `turn:start`, never per stream delta.

Accepted trade-off: a crash mid-turn loses the in-flight turn (the user's last
message and the partial response). Alternatives considered: **debouncing**
moves the stall, doesn't remove it; **off-thread stringify** still pays the
copy out of the renderer; **incremental per-session persistence** is the
structural fix — adopted the same day as [ADR-0021](0021-granular-session-persistence.md),
which this ADR composes with: 0021 bounds WHAT a persist writes, this one
bounds WHEN.

## Consequences

- Don't re-add a `turn:start` persist "for safety" — that's the freeze this
  ADR removes; the safety it bought was one in-flight turn.
- With ADR-0021, the completion-time write is one session's text — small even
  on media-heavy profiles (blobs are written once, at creation).
