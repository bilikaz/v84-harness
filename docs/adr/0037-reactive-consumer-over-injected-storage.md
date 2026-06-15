# ADR-0037: Reactive `Consumer` over injected storage

Status: Accepted
Date: 2026-06-15
Supersedes: [ADR-0004](0004-store-pattern.md) in full — `lib/store.ts` / `createStore` are deleted; `createListeners` moves to `core/storage/consumer.ts`.

## Context

ADR-0004 gave every domain a `createStore<T>(key, defaults)` that baked
localStorage persistence into the store factory. Two things broke that model.

First, ADR-0035 made persistence a real engine on `ctx.storage` (backend
embedded, durable IO owned) — but `createStore` still wrote straight to
`localStorage`, so the config stores (settings / agents / workspaces / ui)
bypassed the engine entirely. storage.md even called them out: "NOT part of this
scheme."

Second, the backend is now swappable at runtime ([ADR-0038](0038-storage-backend-swappable-at-runtime.md)):
login flips `ctx.storage` to a remote backend. A store hard-wired to
`localStorage` can't follow that switch — its data would neither travel to the
server nor reload from it.

So domain persistence had to (a) go through `ctx.storage` like everything else,
and (b) be re-readable on demand when the backend changes.

## Decision

`core/storage/consumer.ts` replaces the store factory with a `Consumer<T>` base
class. `createStore` and `lib/store.ts` are deleted; `createListeners` (the bare
subscribe/notify primitive) moves here.

```ts
abstract class Consumer<T> {
  protected constructor(ctx: Ctx, key: string | null, defaults: T) // registers in the hydration registry
  protected parse(raw: string): T   // override for normalization/migration
  protected commit(next: T): void   // state = next; persist(); notify()
  async hydrate(): Promise<void>    // re-read from ctx.storage (key=null → reset to defaults)
  get(): T
  use(): T;  useSelect<S>(sel: (t: T) => S): S   // useSyncExternalStore bindings
}
```

- **Persistence is the engine's, not the store's.** `commit()` writes
  `ctx.storage.set(key, serialize())`; no consumer touches `localStorage`
  directly. `key=null` means transient (reactive, not persisted) — config/llm,
  approvals, and the lightbox import `createListeners` directly for that.
- **One hydration registry.** Every `Consumer` registers itself at construction;
  `hydrateConsumers()` re-reads them all from the *current* backend. `init()`
  calls it once after the consumers are constructed; the account calls it again
  on every connection change ([ADR-0038](0038-storage-backend-swappable-at-runtime.md) /
  [ADR-0039](0039-account-local-store-and-connection-lifecycle.md)) — so a
  login/logout re-points the data with **no reload**.
- **Subclasses are domain modules.** `Settings`, `Workspaces`, `Agents`, app
  config, and ui state are `Consumer` subclasses constructed with `ctx` in
  `init()` (`initSettings(ctx)` …). They expose plain getter/command facades plus
  `use*()` hooks; the module-facade pattern (call sites stay stable) carries over
  from 0004.
- **Honest about the tail.** `core/sessions/store.ts` is NOT yet a `Consumer` —
  its granular index/messages/media IO ([ADR-0021](0021-granular-session-persistence.md))
  is still served by the `StorageEngine`'s session methods (a "temporary tenant"
  on the engine, carried forward from [ADR-0035](0035-storage-engine.md)). It
  re-hydrates through the same registry hook (`hydrateSessions()`), so the
  connection switch already works for it; folding its bespoke IO into a consumer
  is the next step.

## Consequences

- Every domain persists the same way, through one backend — the "config stores
  bypass the engine" exception in storage.md is gone.
- A backend swap re-points all state at once: `hydrateConsumers()` is the single
  re-read path, so online/offline (and login/logout) need no reload.
- The `useSyncExternalStore` stable-reference rule is now a base concern:
  `useSelect` selectors must return a stable reference, and derived views are
  cached and cleared in `notify()` (Settings does this for its chat/registry
  views, [ADR-0042](0042-unified-settings-registry.md)) — a fresh object per call
  loops.
- One sanctioned deviation remains (the sessions store), and it is smaller than
  before: not "uses a different factory" but "its durable IO hasn't moved off the
  engine yet."
