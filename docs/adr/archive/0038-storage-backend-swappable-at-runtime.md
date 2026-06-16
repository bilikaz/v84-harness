# ADR-0038: Storage backend swappable at runtime (local baseline + remote)

Status: Accepted
Date: 2026-06-15
Builds on: [ADR-0035](0035-storage-engine.md) — the engine keeps its embedded backend and durable-IO ownership; this adds a second (remote) backend and a runtime switch. Amends 0035's "init picks the backend": `init` now picks the *local baseline*; the connection adds/removes the remote on top.

## Context

ADR-0035 had each `init()` choose ONE backend and wrap it in a `StorageEngine`
for the life of the process. The connected-account design (the project goal:
everything but the account follows the connection — local when offline, remote
when logged in) needs the engine to hold both and switch live, with no reload:
the user toggles online/offline from Settings and expects their data to follow.

## Decision

`StorageEngine` holds a **local baseline** (always present) and an **optional
remote** backend; the active backend is `remote ?? local`.

```ts
class StorageEngine {
  constructor(local: Storage, remote: Storage | null = null)
  get connected(): boolean         // remote !== null
  connect(remote: Storage): void   // login
  disconnect(): void               // logout
  // generic kv over the ACTIVE backend — what consumers use:
  get / set / del / keys / getJSON / setJSON
}
```

- **The remote backend is `RemoteStorage`** (`core/storage/remoteStorage.ts`):
  the same `Storage` port (`get/set/del/keys`) over HTTP to the knowledge API's
  `/data` surface ([ADR-0040](0040-knowledge-remote-service.md)). It is
  host-agnostic (just `fetch`) and takes an `authedFetch` so the token + refresh
  stay in the account ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md)).
  Keys are URL-encoded (they carry `:` separators); a 404 on `get` is a clean
  miss, not an error.
- **`init()` picks the local baseline** (electron: SQLite; web:
  IndexedDB → localStorage) and constructs the engine with
  `remote = isConnected() ? new RemoteStorage(authedFetch) : null` — so a relaunch
  while already connected comes up remote.
- **The switch is two steps, and policy lives elsewhere.** `connect`/`disconnect`
  only flip the field; the account then calls `hydrateConsumers()` +
  `hydrateSessions()` to re-read all state from the new backend
  ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md) owns that
  sequence). The engine stays mechanism, not policy.
- **Generic kv is the consumer surface.** Consumers
  ([ADR-0037](0037-reactive-consumer-over-injected-storage.md)) use
  `get/set/del/keys/getJSON/setJSON` and neither know nor care which backend is
  active. The session methods (`loadIndex`/`saveMessages`/…) likewise run over the
  active backend unchanged — so transcripts and media blobs travel to the server
  when connected, exactly like config.

## Consequences

- Online/offline is a live toggle: flip the backend, re-hydrate, done — no
  reload. Tokens are kept across the toggle so reconnect needs no re-login
  ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md)).
- Everything that goes through `ctx.storage` follows the connection for free —
  settings, agents, workspaces, sessions, media. Only the account is deliberately
  exempt ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md)).
- The remote backend inherits the port's blob contract: `saveMessages` writes
  media blobs as separate `/data` keys server-side, same GC, same inflate. Large
  transcripts over HTTP are now a real cost to watch (per-blob round-trips) —
  noted, not yet optimized.
- The re-hydrate can only be forgotten if a caller flips the backend without
  going through the account's `setConnection`/`login`/`logout` — those are the
  sole intended callers, and the engine's `connect/disconnect` are otherwise
  policy-free.
