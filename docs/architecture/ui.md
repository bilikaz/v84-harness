# UI layer

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

- **Contribution registry** ([ADR-0008](../adr/0008-ui-registry-routing.md)):
  `lib/registry.ts` defines named regions (`left-top`, `right-panel`,
  `settings`, `main`). Each `pages/<feature>/register.tsx` calls `register(...)`;
  `renderer/main.tsx` eagerly globs all register files at boot; `<Slot region>` renders
  contributions. Features plug in without touching `App.tsx`. The `Region` type
  only lists surfaces the shell actually renders — the former `menu` region was
  deleted when it lost its renderer ([ADR-0024](../adr/0024-agent-runs-through-composer.md)).
- **Plugin contributions** ([plugins.md](plugins.md)): a plugin's `ui/register.tsx` is globbed at boot
  like a feature's, but each contribution carries a `pluginId`. `<Slot>` (and `SettingsModal`, for the
  settings menu) **drop a contribution whose plugin is disabled** (`usePluginsConfig`), so enabling/
  disabling a plugin adds/removes its UI live. An enabled plugin's settings get their **own
  settings-menu section** (`settings` region, gated); the core "Plugins" section
  (`pages/settings/PluginsSection.tsx`) is the enable/disable master list.
- **Right panel**: the context-window card (`ProgressPanel`, order 0), the
  agents library (`AgentsPanel`, order 1 — one row per agent, filtered to the
  active context, hover play/pencil), the sub-agent run-log cleanup button
  (`SubAgentCleanup`, order 2 — red "Delete N run logs", rendered only when the
  active session has child runs), and the agent-permissions card
  (`AgentPermissionsPanel`, order 3 — agent-based sessions only: governing
  regime, accordion of effective tool modes, Unlink;
  [ADR-0026](../adr/0026-agent-session-placement-vs-capability.md)).
- **Agents UX** ([ADR-0024](../adr/0024-agent-runs-through-composer.md)): clicking
  an agent opens the primed run page (`agents/<id>`) — a pseudo session whose
  composer is seeded with the agent's user template; the real session
  materializes on send. `agents/<id>/edit` is the editor (description = the
  orchestrator-facing contract, workspace & permissions block). The shared
  `Composer` component is the one run form everywhere; sub-agent child sessions
  render read-only (no composer) with a footer of three pieces — the read-only
  notice (plain text), Open-parent, and "Delete run log" (lands on the parent) —
  indented under their parent in the sidebar. A deleted child's ToolCard chip
  stays as an unclickable "Run log deleted" tombstone, never a silent gap.
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
