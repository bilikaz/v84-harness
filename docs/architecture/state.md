# State management & event bus

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

## State management

The reactivity + persistence layer is `core/storage/consumer.ts`
([ADR-0037](../adr/0037-reactive-consumer-over-injected-storage.md), which
supersedes the old `lib/store.ts` `createStore` factory):

- `createListeners()` — the bare subscribe/notify primitive. Transient stores
  that aren't Consumers (config/llm, approvals, the lightbox) import it directly.
- `Consumer<T>` — in-memory reactive state persisted as **one row in the
  `settings` table** of a `ctx.storage` provider
  ([ADR-0043](../adr/0043-per-entity-repos.md)). A subclass gives a key plus its
  domain methods (and may override `parse` for normalization/migration);
  `key=null` is transient (reactive, not persisted). `commit(next)` sets state →
  persists → notifies; `use()` / `useSelect(sel)` are the `useSyncExternalStore`
  bindings. The subclasses are `Settings`, `AppConfig`, `UiPanel`, and
  `BrowserFleetStore`, constructed with `ctx` in each platform `init()`
  (`initSettings(ctx)` …).

Every `Consumer` registers itself; `hydrateConsumers()` re-reads them all from
their provider — called once at init, and again on each connection change.
Login/logout swaps the active provider behind `ctx.storage` and re-hydrates, with
no reload ([ADR-0044](../adr/0044-storage-engine-provider-swap.md) /
[storage.md](storage.md)) — though only the **synced** consumers actually change
realms (below).

Conventions:

- Every store exposes plain getter/command facades plus `use*()` hooks. Components
  consume hooks only — never the consumer object directly. The module facade keeps
  call sites stable.
- Mutations go through `commit()` (immutable next-state → persist → notify).
  `useSelect` selectors must return a **stable reference**; derived views are
  cached and cleared in `notify()` (Settings does this —
  [ADR-0042](../adr/0042-unified-settings-registry.md)), because a fresh object
  per read loops `useSyncExternalStore`.

### Machine-local vs account-synced

A `Consumer`'s `synced` flag (default `false`) decides which provider lane its
row lives in ([ADR-0045](../adr/0045-machine-local-vs-account-synced.md)):

- **synced** → `ctx.storage.repos()` (the active provider), `scope: "account"`.
  Follows the connection — lands in the cloud when connected, on the device
  offline. The synced state is `settings` (providers/models incl. API keys),
  `agents`, and app `config`.
- **machine-local** (default) → `ctx.storage.localRepos()` (always the device),
  `scope: "local"`. Pinned to the machine, never swapped to the (empty) remote on
  connect. This is `ui` (the right-panel preference) and `browser` (the fleet
  store, which is `key=null` — transient, persists nothing).

Two stores sit outside the consumer/provider layer entirely: `lang`
(`lib/i18n.ts`, key `v84-harness:lang`) and the LLM `debug` flag (`llm/debug.ts`,
key `v84-harness:llm-debug`). Both read `localStorage` **synchronously at module
load**, before `ctx` (and any provider) exists — which is precisely why they
can't be async-backed Consumers. They are machine-local by construction.

`core/account.ts` is the third store off the layer — `localStorage`,
synchronous, deliberately NOT a Consumer. It's machine-local too, but special
for a different reason: it must be readable **before the provider is chosen** (it
*is* what chooses it) and must survive a logout. The old "one local-only store"
framing is stale — `ui`, `browser`, `lang`, and `debug` are all machine-local
now; account is just the one read first.

### The store taxonomy

Two kinds of store share the one reactivity primitive (`createListeners`):

- **Consumer** — a single state blob → one `settings`-table row. `settings`,
  `ui`, app `config`. Synced or machine-local per the flag above.
- **Entity store** — many rows across a dedicated table, via `ctx.storage`
  directly. `containers`, `sessions`, `agents` (each `init()`-injects the engine
  and hydrates from `repos()` / `localRepos()`).

`sessions` is **not** a Consumer by design: it's per-row, lazy-loaded, spans
multiple tables (sessions / messages / media), and deletes are provider-aware
(local hard, remote soft). A single blob Consumer would re-introduce the
whole-list write that caused the index-blob data-loss bug
([storage.md](storage.md) charts the rows, shapes, and accessor surface;
[ADR-0043](../adr/0043-per-entity-repos.md)). It re-hydrates through the same
connection-change path as everything else, so the swap already covers it.

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
