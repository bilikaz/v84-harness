# State management & event bus

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

## State management

Two building blocks in `lib/store.ts`:

- `createListeners()` — bare subscription registry, for stores with irregular needs.
- `createStore<T>(key, defaults, load?)` — the standard factory: localStorage
  persistence (a `null` key means transient), defaults merge, optional `load()`
  shape-migration hook, `subscribe`/`get`/`set`, and React bindings `use()` /
  `useSelect()` built on `useSyncExternalStore`.

Conventions ([ADR-0004](../adr/0004-store-pattern.md)):

- Every store exposes plain getter/mutator functions plus `use*()` hooks.
  Components consume hooks only — never the store object directly.
- Mutations are immutable (spread/copy) and end with `notify()`.
- `core/sessions/store.ts` is the one sanctioned deviation: it uses
  `createListeners()` directly because its persistence is granular and async
  (index / per-session messages / media blobs over the storage port —
  [ADR-0021](../adr/0021-granular-session-persistence.md),
  [ADR-0017](../adr/0017-storage-port-with-detected-backends.md)). Don't copy that
  shape for ordinary stores. The full key scheme, shapes, and accessor surface
  are charted in [storage.md](storage.md).

## Event bus

`lib/bus.ts` is a synchronous typed event bus. Domains declare events by
declaration-merging into `BusEvents` and take a scoped view (`scope("session")`).
Event names are `<domain>:<topic>[:<subtopic>]`, e.g. `session:turn:start`,
`session:tool:calls` ([ADR-0005](../adr/0005-event-bus.md)).

The bus decouples the sessions engine from the store: `driver.ts` emits,
`listeners.ts` subscribes and mutates the store, and self-contained services
(`naming.ts`, `compaction.ts`) subscribe independently and run in the background
(`void`-ed promises). Handlers are isolated — one throwing is logged
(`bus handler_crashed`) and never silences the handlers behind it. Every
subscribing module registers HMR cleanup via `import.meta.hot.dispose`; modules
holding live state (the driver's inflight map, the approval queue) also flush it
on dispose.
