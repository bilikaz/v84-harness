# UI layer

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

- **Contribution registry** ([ADR-0008](../adr/0008-ui-registry-routing.md)):
  `lib/registry.ts` defines named regions (`left-top`, `right-panel`,
  `settings`, `main`). Each `pages/<feature>/register.tsx` calls `register(...)`;
  `main.tsx` eagerly globs all register files at boot; `<Slot region>` renders
  contributions. Features plug in without touching `App.tsx`. The `Region` type
  only lists surfaces the shell actually renders — the former `menu` region was
  deleted when it lost its renderer ([ADR-0024](../adr/0024-agent-runs-through-composer.md)).
- **Right panel**: the context-window card (`ProgressPanel`, order 0) and the
  agents library (`AgentsPanel`, order 1) — one row per agent, filtered to the
  active context, hover play/pencil.
- **Agents UX** ([ADR-0024](../adr/0024-agent-runs-through-composer.md)): clicking
  an agent opens the primed run page (`agents/<id>`) — a pseudo session whose
  composer is seeded with the agent's user template; the real session
  materializes on send. `agents/<id>/edit` is the editor (description = the
  orchestrator-facing contract, workspace & permissions block). The shared
  `Composer` component is the one run form everywhere; sub-agent child sessions
  render read-only (no composer) with a back-to-parent note, indented under
  their parent in the sidebar.
- **Routing**: minimal hash router (`lib/router.ts`) — `useRoute()` + `navigate()`.
- **Modals**: the shared `components/Modal.tsx` shell for all dialogs. Major
  feature modals are route-driven (Settings); short-lived confirmations use local
  `useState` + `ConfirmActions`.
- **Styling**: Tailwind classes composed with `cn()` (clsx + tailwind-merge).
  Inline `style` only for values computed at runtime (e.g. a percent width).
- **Forms**: settings sections share `pages/settings/Field.tsx` (`Row`, input
  class variants, `DetectButton`).
- **Components stay small**: transcript-rendering pieces (Message, ToolCard,
  Thinking) are standalone files, not nested inside page components.

Recurring UI patterns (codified from review; reuse before reinventing):

- **Registry order** is per-region, lower first, default 0; pick the next free
  integer in that region (`pages/*/register.tsx`).
- **Async probe** (`lib/hooks.ts` `useDetection`): a Detect/Test button wraps a
  probe returning `{ ok, count, error }` plus a format function; the hook owns
  the busy flag and message. Used by Provider and Media sections.
- **Form inputs** use the `pages/settings/Field.tsx` class variants:
  `fieldInput` (fixed-width settings field), `fieldInputFlex` (shares a row
  with a button), `fieldInputFull` (full-width modal forms), `fieldInputBare`
  (compose your own width).
- **Store shape migrations** go through `createStore`'s `load()` hook: try the
  new key, fall back to the legacy key, coerce through a `normalize()` —
  one-time, at creation (see `core/agents.ts`).

## i18n

([ADR-0009](../adr/0009-i18n.md), rules in [conventions/i18n.md](../conventions/i18n.md))
i18next + react-i18next; resources in `src/locales/` (`en.json`, `lt.json`);
language persisted under `v84-harness:lang`. The locale pair stays key-for-key —
parity is checked by diffing key sets.
