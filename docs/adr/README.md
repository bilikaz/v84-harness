# Architecture Decision Records

Dated, immutable log (see [conventions/documentation.md](../conventions/documentation.md)).
One decision per ADR; supersede, don't rewrite. The map of current structure is
[../ARCHITECTURE.md](../ARCHITECTURE.md); portable rules are
[../conventions/](../conventions/).

| ADR | Decision | Status |
| --- | --- | --- |
| [0000](0000-adr-scope.md) | What lands in this log: architectural decisions only | accepted |
| [0001](0001-dual-target-build.md) | Dual-target build: pure web Vite + Electron from one renderer | accepted |
| [0002](0002-typed-ipc-bridge.md) | Typed IPC bridge — `IPC` channel constants + `HarnessApi` | accepted |
| [0003](0003-host-agnostic-core.md) | Host-agnostic `core/`, migrated from `lib/` feature-by-feature | accepted (migration ongoing) |
| [0004](0004-store-pattern.md) | `createStore` factory + `useSyncExternalStore` hooks | accepted |
| [0005](0005-event-bus.md) | Typed, domain-scoped event bus via declaration merging | accepted |
| [0006](0006-provider-abstraction.md) | Provider adapters behind a unified `StreamEvent` stream | accepted |
| [0007](0007-tool-system.md) | Tool system: gated vs permissionless, virtual root, never-throw | accepted |
| [0008](0008-ui-registry-routing.md) | UI contribution registry (Slot regions) + hash router | accepted |
| [0009](0009-i18n.md) | i18n via i18next, en/lt key parity | accepted |
| [0010](0010-adopt-shared-conventions.md) | Adopt the shared conventions set (with recorded deviations) | accepted |
| [0011](0011-contribute-ui-conventions.md) | Contribute UI-layer conventions to the shared set | accepted |
| [0012](0012-sessions-dual-tier-persistence.md) | Sessions dual-tier persistence (localStorage + IDB) | accepted |
| [0013](0013-approval-promise-bridge.md) | Approval Promise bridge driver ↔ UI | accepted |
| [0014](0014-stop-semantics-and-tool-cancellation.md) | Stop semantics + tool cancellation over IPC | accepted |
| [0015](0015-prompt-assets.md) | Prompt assets: English-only `pt()` catalog, outside i18n | accepted |
| [0016](0016-workspace-isolation-field.md) | Workspace isolation field (`worktree` \| `direct`) | **debatable — no concept yet** |
| [0017](0017-storage-port-with-detected-backends.md) | Storage port with detected backends (SQLite > IDB > localStorage) | accepted |
| [0018](0018-capability-gated-media-tools.md) | Capability-gated media tools (LoadImage/LoadVideo) + unified media feedback | accepted |

## Needs review / important missing parts

Decisions or gaps that are recorded but **not settled** — revisit before the
related area grows. Resolving one means writing/superseding an ADR and removing
it from this list.

| Item | Where recorded | What's missing |
| --- | --- | --- |
| Workspace isolation (`worktree`) | [ADR-0016](0016-workspace-isolation-field.md) | The entire concept: worktree lifecycle, merge-back, non-git workspaces. Field is settable but read by nothing. |
| `Session.steps` progress DAG | this list | Declared on the session type ("rendered in the right panel"), persisted, but nothing ever writes or renders a step — same declared-not-implemented state as ADR-0016. Design or remove. |
| Storage quota warning | [ADR-0012](0012-sessions-dual-tier-persistence.md) | Manual pruning shipped (Settings → Storage: per-workspace/session usage + delete). Still missing: a user-facing warning when a persist write fails (today it's only a logged `persist_failed`). |
| Video job orphaning on cancel/quit | [ADR-0014](0014-stop-semantics-and-tool-cancellation.md) | Stop ends polling but the server job keeps running; no job-id persistence for resume or cleanup (endpoint has no cancel API). |
| Bridge startup handshake | [ADR-0002](0002-typed-ipc-bridge.md) | 15 IPC channels now (was 6 when "revisit if it grows" was written); a missing handler still hangs the invoke silently. A startup ping would catch it. |
| Tests/typecheck not in CI | conventions/testing.md | `.github/workflows/review.yml` runs the reviewer gate only; nothing runs `pnpm typecheck` / `pnpm test` on push. |
| Account "Connected" mode | AccountSection (`soon` badge) | The company-system link (knowledgebase/sync) is a UI placeholder with no design. |

Resolved since first written: reasoning config beyond OpenAI-compatible
(ADR-0006 — effort now maps to all three providers), the `lib/` → `core/`
migration tail (settings/media/agents moved to `core/`), conventions upstream
sync (copied to the reviewer repo), desktop storage quota ceiling (ADR-0017),
and storage growth pruning (manual, Settings → Storage).
