# ADR-0035: Storage engine — backend embedded, persistence owned; init picks the backend

Status: Accepted
Date: 2026-06-14
Supersedes: [ADR-0017](0017-storage-port-with-detected-backends.md) in full (archived) — the `Storage` port and SQLite-in-main design are carried forward here; `detectStorage`/`lib/storage` are replaced.

## Context

ADR-0017 gave us the `Storage` port and `detectStorage()` — a memoized best-first
probe (sqlite → idb → local) living in `lib/storage/index.ts`, with backends as
self-probing `<Impl>Storage.create()` factories and a tier-upgrade migration baked
into the sessions store. Two problems hardened since. First, the durable IO itself
— the index/messages key shapes, the media-blob stamp/inflate/GC dance — lived in
`core/sessions/persistence.ts`, so the store knew both the *shapes* and the *bytes*,
and "where does a media blob get written?" was answered in the sessions domain, not
in storage. Second, with platform hosts (ADR-0034) the backends were
host-specific (SQLite needs the bridge; IndexedDB/localStorage are browser-only) yet
detection lived in agnostic `lib/`, dragging the SQLite client into the web bundle's
reach. The port was right; its mechanism was in the wrong place and owned too little.

## Decision

`core/storage/` keeps the **`Storage` port** (`types.ts`) and adds a **`StorageEngine`**
(`engine.ts`) that EMBEDS one selected backend and OWNS the durable session IO.

```ts
// core/storage/engine.ts
class StorageEngine {
  constructor(private readonly backend: Storage) {}
  loadIndex(): Promise<SessionsIndex | null>
  saveIndex(index: SessionsIndex): Promise<void>
  saveMessages(sid, messages): Promise<number>   // stamps + GCs media blobs; returns footprint
  loadMessages(sid): Promise<Message[] | null>   // inflates blob refs
  deleteSessionData(sid): Promise<void>
}
```

- **One persistence surface.** The key shapes (`…:sessions:index`,
  `…:sessions:msgs:<sid>`, `…:media:<sid>:<id>`) and the media-blob lifecycle move
  out of `core/sessions/persistence.ts` into the engine. A data-URL media ref gets a
  UUID stamped IN PLACE on first persist (the stamp marks "blob already written", so
  refs shared across messages write one blob); `saveMessages` GCs blobs no longer
  referenced, `loadMessages` inflates the `media:<id>` stand-ins back. `persistence.ts`
  now holds only the pure shapes — `SessionMeta`, `SessionsIndex`, `toMeta`,
  `normalize` — and is storage-agnostic again.
- **`detectStorage` is removed.** Each platform `init()` selects its backend and
  wraps it: `electron/init.ts` → `new StorageEngine(await SqliteStorage.create())`;
  `web/init.ts` → IndexedDB, falling back to localStorage (`try IdbStorage.create()`
  `catch LocalStorage.create()`), then `new StorageEngine(backend)`. The engine lands
  on `ctx.storage`. The best-first probe is gone — selection is per host, inline.
- **Backends relocate to their platforms.** `SqliteStorage` →
  `electron/sqliteStorage.ts` (a thin client over the bridge `window.api.storage`; the
  DB itself stays in main — `node:sqlite` `DatabaseSync` under `userData`);
  `IdbStorage` → `web/idbStorage.ts`; `LocalStorage` → `web/localStorage.ts`.
  `lib/storage/` is deleted.
- **The engine is injected, not reached for.** `core/sessions/store.ts` takes the
  engine via `useStorage(engine)`; the `SessionEngine` constructor (ADR-0034) does the
  wiring — `if (ctx.storage) { useStorage(ctx.storage); void hydrate(); }`. Until
  injected, every persist path is a no-op (guarded on `engine`), so a non-renderer host
  built with no storage (`new Ctx(wire.config)` in main, ADR-0032) simply doesn't
  persist — no branch, just an absent dependency.

This **supersedes ADR-0017 in full** (archived). What it carries forward and now owns:
the `Storage` port (with `keys(prefix)` the engine needs for blob GC), the SQLite-in-main
design, and the sqlite → idb → local tier ordering. What it replaces: `detectStorage`, the
`lib/storage` home, and the in-store tier-upgrade migration.

## Consequences

- One thing owns durable IO. "Where is a session written?" has a single answer —
  `StorageEngine` — and the sessions domain is back to shapes only.
- Bundling is platform-correct: the browser never links the SQLite/bridge backend
  (it lives in `electron/`); the SQLite client never reaches for `indexedDB`.
- The blob round-trip is medium-agnostic — `storeRef`/`inflate` are generic over
  `T extends Image | Video`, so one code path stamps and restores both media kinds.
- Persistence is opt-in by construction: a host with no storage doesn't persist, and
  there's no platform check to forget — the no-op falls out of the injection itself
  (ties to ADR-0021's granular per-session persistence, which the engine carries
  forward in `saveMessages`/`persistSession`).
- A media-blob write that fails (quota) degrades per-blob: the ref is left un-stamped
  to retry next persist, the inline data URL is kept as a last resort, and the
  transcript text always survives.
