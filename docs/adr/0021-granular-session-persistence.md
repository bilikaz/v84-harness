# ADR-0021: Granular session persistence (index / messages / media keys)

Status: accepted
Date: 2026-06-10
Supersedes: [ADR-0012](0012-sessions-dual-tier-persistence.md) (both halves: the localStorage first-paint cache and the single durable blob)
Extends: [ADR-0017](0017-storage-port-with-detected-backends.md) (port + detection unchanged; adds `keys(prefix)`)

## Context

The durable tier was a real database used as a single pigeonhole: the entire
profile — every session, message, and media data-URL — lived under one key, so
persisting anything meant `JSON.stringify` of everything (34 MB+ on real
profiles) plus a full IPC ship. A 122 KB chat paid the serialization cost of
the 17 MB image session next to it, on every turn. The localStorage first-paint
cache made it worse: a synchronous multi-MB copy per persist that was
permanently stale for any profile past the ~5 MB quota. Media compounded both:
base64 blobs rode inside message JSON and were re-serialized forever after
being written once. The actual deltas are tiny — a user message, a tool call, a
result — appendable rows.

## Decision

**The storage port stays `key → string`; granularity comes from the key
scheme** (the port gains one method, `keys(prefix)`, for namespace deletes/GC —
all three adapters and the SQLite IPC surface stay otherwise untouched):

- `sessions:index` — activeId + per-session metadata (title, workspace, tool
  policy, usedTokens, unread, approximate bytes). Small; written on meta
  changes.
- `sessions:msgs:<sid>` — one session's messages. Written by `persistSession`
  at turn completion (ADR-0020) — cost is that session's text, nothing else.
- `media:<sid>:<id>` — one media blob (a data: URL), written ONCE when first
  persisted. The ref's `id` is stamped on the in-memory object at write time —
  the stamp marks "already stored", and messages sharing the ref object (the
  media-feedback turn) share the blob. Stored messages carry `media:<id>`;
  loading reinflates. Blob writes degrade per-blob (a quota-dead blob never
  loses text). A transcript rewrite (compaction) GCs orphaned blobs against the
  live id set.

**Boot reads the index + the active session only**; other sessions lazy-load on
first open (`ensureLoaded`, deduplicated in-flight). The localStorage
first-paint cache is deleted outright — a one-or-two-frame skeleton behind
`useHydrated()`/`session.loaded` replaces it. localStorage remains only as the
port's last-resort detected backend (the "dumb wrapper"), storing the same
granular keys.

**Migration** is one-shot and chained: granular index → legacy single-key blob
split in place → cross-tier IDB import (all domain keys copied) → fresh.

## Consequences

- Persist cost is proportional to what changed; the per-turn whole-profile
  stringify + IPC stall is gone, and a media blob is serialized once in its
  lifetime instead of on every persist of anything.
- Sessions are independent rows in practice — the shape cloud sync needs
  (per-key replication), unlike one giant blob.
- In-memory ImageRefs are mutated once (the `id` stamp) outside the store's
  immutable-update discipline — deliberate, documented on the type.
- A session being streamed must be in memory; all activation paths run through
  `ensureLoaded`, and `persistSession` refuses to write an unloaded shell so a
  race can never clobber rows with emptiness.
- The Settings → Storage meter reads the per-session `bytes` recorded at
  persist time instead of stringifying in-memory state.
