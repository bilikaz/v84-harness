# ADR-0003: Host-agnostic `core/`, migrated from `lib/` feature-by-feature

Status: accepted (migration in progress)
Date: 2026-06-10 (documented retroactively)

## Context

Domain logic originally accumulated in `lib/` mixed with renderer utilities. The
long-term goal is reusing the engine outside this Electron host (other shells,
headless/CI). A big-bang restructure would stall feature work.

## Decision

- `core/` holds host-agnostic domain logic: no Electron imports, no React imports
  in engine code. React bindings live only in `hooks.ts` files as thin
  `useSyncExternalStore` wrappers.
- Migration happens feature-by-feature. `sessions` went first and defines the
  **target module shape**:

  `store.ts` (state/selectors/mutations) · `driver.ts` (orchestration) ·
  `events.ts` (bus contracts) · `listeners.ts` (bus → store) · `hooks.ts`
  (React) · self-contained services (`naming.ts`, `compaction.ts`) · `index.ts`
  (barrel + side-effect wiring).

- **Folder-split threshold**: a core feature stays a single file
  (`core/approvals.ts`, `core/workspaces.ts`) while it is just
  state + commands + hooks. It splits into the folder shape as soon as it gains a
  driver, bus events, listeners, or background services. Splitting small files
  pre-emptively is churn, not architecture.
- `lib/` keeps genuinely renderer-flavored utilities (i18n, router, registry, cn,
  store factory, bus) and settings-type stores until their feature migrates.

## Consequences

- The engine is testable and portable; the sessions driver has no idea it runs in
  Electron.
- Two homes for code exist during the migration; the rule for "which one" is:
  domain logic → `core/`, renderer plumbing → `lib/`.
- `core/` may import shared types and the store factory from `lib/` (those are
  host-agnostic helpers despite the folder name); the reverse direction —
  `lib/` importing feature logic from `core/` — should not happen.
