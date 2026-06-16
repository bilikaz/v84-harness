# ADR-0044: `StorageEngine` — provider swap with a machine-local lane

Status: Accepted
Date: 2026-06-16
Supersedes: [ADR-0038](0038-storage-backend-swappable-at-runtime.md) (KV backend swap, `remote ?? local`). Builds on [ADR-0043](0043-per-entity-repos.md) (the `StorageRepos` it swaps). The runtime-swap idea carries forward; what changes is the unit swapped (repositories, not a KV backend) and the addition of a second, never-swapped lane for machine state.

## Context

ADR-0038 had a `StorageEngine` hold a local + optional remote KV backend and
expose the active one (`remote ?? local`) to everything. Two things forced a
revision once 0043 replaced the KV substrate and the connected account shipped:

1. The thing being swapped is now `StorageRepos`, not a `Storage` KV port.
2. **Not everything should follow the connection.** Under 0038 *every* consumer
   travelled to the server on login. But the provider/model config (with API
   keys), the UI layout, and app tunables are properties of *this machine*, not
   the account — and on first connect to a fresh account the remote is empty, so
   "follow the connection" blanked the user's settings. Machine state needs to
   stay put while content follows the account.

## Decision

`StorageEngine` (`core/storage/engine.ts`) holds a **local** provider (always
present) and an **optional remote**, and exposes **two lanes**:

```ts
class StorageEngine {
  constructor(local: StorageRepos, remote: StorageRepos | null = null)
  get connected(): boolean        // remote !== null
  connect(remote: StorageRepos): void
  disconnect(): void
  repos(): StorageRepos       // remote ?? local — CONTENT, follows the connection
  localRepos(): StorageRepos  // always local — MACHINE state, pinned to the device
}
```

- **`repos()` = the active provider** (`remote ?? local`). Content — containers,
  sessions, messages, media, and the synced consumers ([ADR-0045](0045-machine-local-vs-account-synced.md)) —
  reads/writes here, so it follows the connection: the cloud when logged in, the
  local backend offline.
- **`localRepos()` = always the local provider.** Machine state — the UI panel,
  browser fleet, and the machine-scoped consumers — uses this lane, so connecting
  never swaps it onto an empty remote.
- **Swap, not merge; realms are independent.** `connect`/`disconnect` only flip
  the remote field; `account.ts applyConnection()` then re-hydrates every store
  from the now-active provider. Nothing migrates between realms — an empty remote
  shows nothing, a populated one shows its own rows. First connect is a *switch*,
  not an upload of local data.
- **Three injectable backends, chosen by host init + login.** Each platform
  `init()` builds the local provider for its host and adds the remote when
  connected: **electron offline →** main-process SQLite (`sqliteRepos`, with an
  IndexedDB fallback if `node:sqlite` can't open); **browser offline →**
  IndexedDB (`idbRepos`); **either, connected →** the remote API client
  (`remoteRepos`). Tests inject `memoryRepos`. The engine is pure mechanism; which
  providers it holds is decided at injection.
- **The engine stays mechanism, not policy.** It never re-hydrates or decides
  *what* is machine vs content — `connect`/`disconnect` are field flips, the
  account owns the re-hydrate sequence ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md)),
  and each store decides its lane by calling `repos()` or `localRepos()`.

## Consequences

- **Online/offline is a live toggle** — flip the remote, re-hydrate, no reload;
  tokens are kept so reconnect needs no re-login ([ADR-0039](0039-account-local-store-and-connection-lifecycle.md)).
- **Machine state survives the swap.** Connecting to a fresh account no longer
  blanks settings/UI — those read `localRepos()` and stay put. The split of which
  store uses which lane is [ADR-0045](0045-machine-local-vs-account-synced.md).
- **No accidental migration.** Because connect is a swap, there is no code path
  that uploads local content to the cloud (or vice-versa); the two realms can
  diverge freely, which is the intended model ("your laptop's offline chats are
  not your account's chats").
- **A store that picks the wrong lane is the failure mode.** Putting content on
  `localRepos()` strands it offline; putting machine state on `repos()` blanks it
  on connect. The lane choice is the one thing each store must get right — called
  out in [ADR-0045](0045-machine-local-vs-account-synced.md) and the state map.
