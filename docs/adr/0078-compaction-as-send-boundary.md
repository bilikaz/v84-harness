# ADR-0078: Compaction is a send boundary, not a transcript rewrite

Status: Accepted
Date: 2026-07-08
Amends the compaction clause of commit-on-landing ([ADR-0072](0072-commit-on-landing.md)); aligns
compaction with the media resend window's philosophy ([ADR-0025](0025-media-resend-window.md)).
Present-tense map: [architecture/sessions.md](../architecture/sessions.md),
[architecture/storage.md](../architecture/storage.md).

## Context

Compaction destroyed the transcript: `replaceWithSummary` swapped ALL messages for one summary row
and GC'd the orphaned media. The user lost their own conversation history (the UI showed only the
summary), and — fatal to [ADR-0077](0077-media-reference-aliases.md) — every media alias died with
its blob, killing generation cycles the moment a long session compacted. Meanwhile the resend window
had already established the right shape for context pressure: **the transcript and UI keep
everything; only what is SENT shrinks.**

## Decision

**Compaction joins the resend window as a pure send policy.**

- `compact()` **appends** the summary as a normal `summary: true` message via the ordinary
  commit-on-landing path. Nothing is rewritten, deleted, or GC'd.
- The send filter in `toChatMessages` is positional: **send the last summary message + everything
  after it** (sliced before the media window, so the window budget isn't spent on unsent messages).
  *Alternative rejected:* per-message "compacted" flags — hundreds of old-row rewrites per compaction
  for state the summary's position already encodes. *Alternative rejected:* a boundary pointer in
  `session.meta` — redundant with position, and one more thing to keep consistent.
- The UI derives the same boundary: messages above the last summary stay visible (dimmed, behind a
  "compacted — no longer sent to the model" divider); the summary renders as a collapsed card.
- The summariser carries forward an `img-N` inventory (one line per still-relevant alias) so the
  model retains awareness of referenceable assets across the boundary.

## Consequences

- **The last wholesale transcript rewrite is gone**: `replaceWithSummary`/`persistSession` are
  deleted, and ADR-0072's "replaceForSession survives for compaction" clause narrows to the
  offline-delete clear. Commit-on-landing now covers every persist path.
- Re-compaction is incremental for free — the summariser input (`toChatMessages`) already starts at
  the previous summary.
- Media aliases resolve for the session's whole life; the user scrolls their full history and can
  reference anything in it ("use img-3") regardless of what the model currently sees.
- The accepted trade: transcripts and media grow unbounded per session — that is the point (no loss),
  with transcript virtualization a known someday-item for very long sessions. `deleteSession` still
  removes everything.
- Sessions compacted destructively before this change keep their single-summary transcript; they
  just continue under the new rules.
