# State management & event bus

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

## State management

The reactivity + persistence layer is `core/storage/consumer.ts`
([ADR-0037](../adr/0037-reactive-consumer-over-injected-storage.md), which
supersedes the old `lib/store.ts` `createStore` factory):

- `createListeners()` — the bare subscribe/notify primitive. Transient stores
  that aren't Consumers (config/llm, approvals, the lightbox) import it directly.
- `Consumer<T>` — in-memory reactive state persisted **through `ctx.storage`**
  ([ADR-0035](../adr/0035-storage-engine.md)). A subclass gives a key plus its
  domain methods (and may override `parse` for normalization/migration);
  `key=null` is transient (reactive, not persisted). `commit(next)` sets state →
  persists → notifies; `use()` / `useSelect(sel)` are the `useSyncExternalStore`
  bindings. `Settings`, `Workspaces`, `Agents`, app config, and ui state are
  subclasses, constructed with `ctx` in each platform `init()`
  (`initSettings(ctx)` …).

Every `Consumer` registers itself; `hydrateConsumers()` re-reads them all from the
*current* backend — called once at init, and again on each connection change.
Login/logout swaps the backend behind `ctx.storage` and re-hydrates, with no
reload ([ADR-0038](../adr/0038-storage-backend-swappable-at-runtime.md) /
[ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md)).

Conventions:

- Every store exposes plain getter/command facades plus `use*()` hooks. Components
  consume hooks only — never the consumer object directly. The module facade keeps
  call sites stable.
- Mutations go through `commit()` (immutable next-state → persist → notify).
  `useSelect` selectors must return a **stable reference**; derived views are
  cached and cleared in `notify()` (Settings does this —
  [ADR-0042](../adr/0042-unified-settings-registry.md)), because a fresh object
  per read loops `useSyncExternalStore`.
- The one local-only store is `core/account.ts` — `localStorage`, synchronous,
  deliberately NOT a Consumer: it must be readable before the backend is chosen
  and must survive a logout
  ([ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md)).
- `core/sessions/store.ts` is the remaining deviation: still `createListeners()`
  plus the `StorageEngine`'s session IO (granular index / per-session messages /
  media blobs — [ADR-0021](../adr/0021-granular-session-persistence.md)), not yet
  a Consumer. It re-hydrates through the same registry hook, so the connection
  switch already covers it; the full key scheme, shapes, and accessor surface are
  charted in [storage.md](storage.md).

## Event bus

`lib/bus.ts` is a synchronous typed event bus. Domains declare events by
declaration-merging into `BusEvents` and take a scoped view (`scope("session")`).
Event names are `<domain>:<topic>[:<subtopic>]`, e.g. `session:turn:start`,
`session:tool:calls` ([ADR-0005](../adr/0005-event-bus.md)).

The bus decouples the sessions engine from the store: `engine.ts` emits,
`listeners.ts` subscribes and mutates the store, and self-contained services
(`naming.ts`, `compaction.ts`) subscribe independently and run in the background
(`void`-ed promises). Handlers are isolated — one throwing is logged
(`bus handler_crashed`) and never silences the handlers behind it. Every
subscribing module registers HMR cleanup via `import.meta.hot.dispose`; modules
holding live state (the driver's inflight map, the approval queue) also flush it
on dispose.
