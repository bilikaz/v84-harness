# ADR-0043: Per-entity storage tables + `StorageRepos` (KV substrate retired)

Status: Accepted
Date: 2026-06-16
Supersedes: [ADR-0035](0035-storage-engine.md) in full (the `Storage` KV port + `StorageEngine`-over-blobs + durable session IO) and [ADR-0021](0021-granular-session-persistence.md) in full (the index/messages/media key scheme). ADR-0017, already archived under 0035, stays archived. Builds toward [ADR-0044](0044-storage-engine-provider-swap.md) (the swap) and [ADR-0045](0045-machine-local-vs-account-synced.md) (the sync split).

## Context

The `Storage` port (0017 → 0035) stored everything as namespaced string blobs
behind `get/set/del/keys`, and a profile's sessions were ONE blob —
`v84-harness:sessions:index` (0021). Two failures hardened:

1. **The index blob is a whole-list read-modify-write.** Opening the same account
   in a second client (e.g. an empty web client) and letting it persist wrote its
   view of the list back over the server's — wiping the other device's sessions.
   A single shared blob has no per-row identity to merge or protect; this was a
   real data-loss bug, not a theoretical one.
2. **A blob can't be queried, partially read, or soft-deleted.** The web client
   had to pull the whole index to show a sidebar; the server couldn't keep a
   deleted row for restore; nothing could read "just this session's messages"
   without the blob. Plugins (own UI, own data — a standing goal) make per-domain
   shapes inevitable, and the blob model has nowhere to put them.

The port was the wrong substrate. The fix is real tables.

## Decision

Replace the KV substrate with **real per-entity tables** and a typed repository
layer, `StorageRepos` (`core/storage/types.ts`). One row per entity; **no master
index** — the rows *are* the list.

```ts
interface StorageRepos {
  containers: CrudRepo<Container>;
  sessions:   CrudRepo<SessionMeta>;
  messages:   MessageRepo;     // listBySession / replaceForSession
  media:      MediaRepo;       // listBySession / put / remove
  agents:     CrudRepo<Agent>;
  settings:   SettingRepo;     // key/value rows, scope local | account
  plugins:    CrudRepo<PluginRow>;
  pluginData: PluginDataRepo;  // (pluginId, collection, key) rows
}
```

- **Per-entity tables, no blob.** containers / sessions / messages / media /
  agents / settings / plugins / plugin_data. Each is its own row, addressed by
  id; the session list is `sessions.list()`, not a slice of a blob. The
  whole-list clobber is now structurally impossible — a client only ever writes
  the rows it touched.
- **Media stays out of the message row.** Blobs live in the `media` table keyed
  by session; a message holds lightweight `media:<id>` refs in its `images` /
  `videos` fields, reinflated on load (`externalizeMedia` / `inflateMedia` in
  `sessions/store.ts`). Message rows stay small; the blob round-trips once.
- **ULID ids, client-generated** (`core/ids.ts newId()`) — sortable and stable
  across the local↔remote boundary, so a row keeps its identity when its realm
  changes.
- **Four implementations behind the interface.** `remote.ts` (the knowledge-API
  client, [ADR-0040](0040-knowledge-remote-service.md)), `idb.ts` (IndexedDB),
  `electron/sqliteStore.ts`+`sqliteRepos.ts` (main-process `node:sqlite` over
  IPC), and `memory.ts` (tests). The server (`apps/knowledge`, MariaDB + kysely)
  mirrors the same per-entity shape.
- **Delete semantics differ by realm.** The local backends HARD-delete the row.
  The remote API's `DELETE` makes the server stamp `deleted_at` (soft) and filter
  it from reads — the client called delete, so it treats the row as gone and
  never sees the retained copy. `deleted_at` is the server-side restore window
  ([ADR-0044](0044-storage-engine-provider-swap.md) holds the realm model).

## Consequences

- **The data-loss bug is designed out.** No shared list blob means no client can
  overwrite another's rows; the worst case is a stale individual row, not a wiped
  profile.
- **Reads are scoped.** A sidebar lists session rows; a transcript loads its own
  messages + media; the web client never pulls what it doesn't render.
- **Soft-delete/restore exists** where it's wanted (server) without burdening the
  local realm, which has nothing to restore from.
- **Plugins have a home** — `plugins` + `plugin_data` are namespaced tables, not a
  reserved slice of someone else's blob.
- **The cost is round-trips.** Per-entity writes/reads are chattier than one blob,
  especially remote (a transcript persists messages + N media rows). Accepted and
  noted; batching is a later optimization, not a substrate change.
- The `StorageEngine` name survives but its meaning changes completely — it no
  longer embeds a KV backend or owns key shapes; it now swaps `StorageRepos`
  providers ([ADR-0044](0044-storage-engine-provider-swap.md)).
