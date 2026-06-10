# ADR-0004: External stores via `createStore` factory + `useSyncExternalStore` hooks

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

State must be readable from non-React code (the sessions driver, tools, services)
and observable from React, with persistence across restarts. Redux/Zustand-class
dependencies are more machinery than this app needs.

## Decision

`lib/store.ts` provides:

- `createListeners()` — a bare subscription registry.
- `createStore<T>(key, defaults, load?)` — the standard store: localStorage
  persistence under `key` (`null` = transient), defaults merge, optional `load()`
  for shape migrations, `get`/`set`/`subscribe`, and React `use()` / `useSelect()`
  built on `useSyncExternalStore`. Handles HMR cleanup.

Conventions:

- Each store module exports plain functions (getters, commands) and `use*()`
  hooks. Components consume hooks only; non-React code calls the functions.
  Nothing outside the module touches the store object.
- Mutations are immutable updates followed by `notify()`.
- `core/sessions/store.ts` deviates deliberately: it builds on
  `createListeners()` because it has dual-tier persistence — localStorage for
  instant first paint, IndexedDB (`lib/idb.ts`) as the source of truth for large
  transcripts, with an async `hydrated` flag. Ordinary stores must use the
  factory, not copy this.

## Consequences

- Zero state-management dependencies; stores are plain modules.
- The same store serves the React UI and the React-free engine.
- localStorage caps (~5 MB) make the factory unsuitable for large data — that is
  exactly the sessions exception; any future large-data store should follow the
  sessions dual-tier approach rather than inventing a third.
