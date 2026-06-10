# ADR-0008: UI contribution registry (Slot regions) + hash router

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

Features (workspace, settings, agents) each contribute UI to several shared
surfaces (sidebar, menu, right panel, settings modal, main area). Hard-wiring
those into `App.tsx` makes every feature touch the shell.

## Decision

- `lib/registry.ts` defines named regions: `left-top`, `menu`, `right-panel`,
  `settings`, `main`. Each feature ships `pages/<feature>/register.tsx` that
  calls `register(region, contribution)`.
- `main.tsx` eagerly globs `./pages/**/register.{ts,tsx}` at boot, so dropping a
  feature folder in is the whole integration. `<Slot region>` renders a region's
  contributions.
- Routing is a minimal hash router (`lib/router.ts`): `useRoute()` reads
  `window.location.hash`, `navigate(route)` writes it. No router dependency.
- Modal conventions: all dialogs render through the shared `components/Modal.tsx`
  shell. Major feature modals are **route-driven** (`#settings/provider` opens
  Settings — state is the URL); short-lived confirmations use local `useState`
  with the shared `ConfirmActions` footer.

## Consequences

- Features are self-contained folders; the shell never enumerates them.
- Eager glob means every register file runs at boot — registration must stay
  side-effect-light (no fetches, no store writes).
- Hash routing is deliberately primitive: flat string routes, no params. If
  routes need parameters, extend the router rather than parsing hashes ad hoc in
  components.
