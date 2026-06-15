# Architecture Decision Records

Dated, immutable log (see [conventions/documentation.md](../conventions/documentation.md)).
One decision per ADR; supersede, don't rewrite. Scope is gated by
[ADR-0000](0000-adr-scope.md): architectural decisions only — bug fixes and
procedures don't land here. The map of current structure is
[../ARCHITECTURE.md](../ARCHITECTURE.md); portable rules are
[../conventions/](../conventions/).

A fully-superseded ADR that nothing current depends on is moved to [archive/](archive/),
leaving a same-name stub at its original path that redirects to the archived original and
the successor (documentation.md rule 2) — inbound links keep resolving, the body stops
loading. Its index row below stays.

| ADR | Decision | Status |
| --- | --- | --- |
| [0000](0000-adr-scope.md) | What lands in this log: architectural decisions only | accepted |
| [0001](0001-dual-target-build.md) | Dual-target build: pure web Vite + Electron from one renderer | accepted |
| [0002](0002-typed-ipc-bridge.md) | Typed IPC bridge — `IPC` channel constants + `HarnessApi` | accepted |
| [0003](0003-host-agnostic-core.md) | Host-agnostic `core/`, migrated from `lib/` feature-by-feature | accepted (migration complete) |
| [0004](0004-store-pattern.md) | `createStore` factory + `useSyncExternalStore` hooks | superseded by 0037 → archived |
| [0005](0005-event-bus.md) | Typed, domain-scoped event bus via declaration merging | accepted |
| [0006](0006-provider-abstraction.md) | Provider adapters behind a unified `StreamEvent` stream | accepted (registry clause superseded by 0029) |
| [0007](0007-tool-system.md) | Tool system: gated vs permissionless, virtual root, never-throw | accepted (virtual-root marker + registration superseded by 0033) |
| [0008](0008-ui-registry-routing.md) | UI contribution registry (Slot regions) + hash router | accepted |
| [0009](0009-i18n.md) | i18n via i18next, en/lt key parity | accepted |
| [0010](0010-adopt-shared-conventions.md) | Adopt the shared conventions set (with recorded deviations) | accepted |
| [0011](0011-contribute-ui-conventions.md) | Contribute UI-layer conventions to the shared set | accepted |
| [0012](0012-sessions-dual-tier-persistence.md) | Sessions dual-tier persistence (localStorage + IDB) | superseded by 0021 → archived |
| [0013](0013-approval-promise-bridge.md) | Approval Promise bridge driver ↔ UI | accepted |
| [0014](0014-stop-semantics-and-tool-cancellation.md) | Stop semantics + tool cancellation over IPC | accepted |
| [0015](0015-prompt-assets.md) | Prompt assets: English-only `pt()` catalog, outside i18n | accepted |
| [0016](0016-workspace-isolation-field.md) | Workspace isolation field (`worktree` \| `direct`) | **debatable — no concept yet** |
| [0017](0017-storage-port-with-detected-backends.md) | Storage port with detected backends (SQLite > IDB > localStorage) | superseded by 0035 → archived |
| [0018](0018-capability-gated-media-tools.md) | Capability-gated media tools (LoadImage/LoadVideo) + unified media feedback | accepted (tool names refined by 0033) |
| [0019](0019-reference-stable-transcript.md) | Reference-stable messages + memoized transcript leaves | accepted |
| [0020](0020-persist-at-turn-completion.md) | Persistence at turn completion only | accepted |
| [0021](0021-granular-session-persistence.md) | Granular session persistence: index / messages / media keys | accepted |
| [0022](0022-subagent-orchestration.md) | Sub-agent orchestration: child sessions + ListAgents/RunAgent pair | accepted |
| [0023](0023-agent-definition-binding-and-ceiling.md) | Agent definition: workspace binding toggle + per-agent tool ceiling | accepted (placement clause superseded by 0026) |
| [0024](0024-agent-runs-through-composer.md) | Agent runs go through the composer (pseudo-session priming) | accepted |
| [0025](0025-media-resend-window.md) | Media resend window + aligned per-item caps | accepted |
| [0026](0026-agent-session-placement-vs-capability.md) | Agent sessions: placement follows launch context, capability masked separately + unlink | accepted |
| [0027](0027-per-model-image-pixel-cap.md) | Images model-checked by dimensions (`imageMaxDim`, renderer downscaling); byte caps become transport bounds | accepted |
| [0028](0028-llm-client-service-calls.md) | One llm client: service-named calls over an injected resolver (`LLMConfigResolver`); heal cycle; tool calls stay engine-side | accepted (ConfigSource renamed `LLMConfigResolver`) |
| [0029](0029-provider-classes-folder-factory.md) | Provider classes resolved by the folder-layout factory; response handlers are response-side only | accepted |
| [0030](0030-unified-call-target.md) | One model-data format held end to end (stores included, no migrations) | accepted (CallTarget → `LLMConfig` / ownership moved to config by 0031) |
| [0031](0031-config-sole-source-of-truth.md) | Config as the sole source of truth — domains under one roof, owners push | accepted |
| [0032](0032-ctx-main-data-carrier.md) | Ctx — the one data carrier (config + llm + storage + tool gateway + host api + sessions) | accepted |
| [0033](0033-tools-registry-folder-by-permission.md) | Tools — host-agnostic registry, dynamic permission tiers, per-platform execution | accepted |
| [0034](0034-platform-hosts-over-agnostic-core.md) | Platform hosts (electron / web) over a host-agnostic core + shared renderer | accepted |
| [0035](0035-storage-engine.md) | Storage engine — backend embedded, persistence owned; init picks the backend (supersedes 0017) | accepted (runtime backend swap added by 0038) |
| [0036](0036-host-capability-surface.md) | Host capability surface — `ctx.api`, platform-injected, gated on presence | accepted |
| [0037](0037-reactive-consumer-over-injected-storage.md) | Reactive `Consumer` over injected storage (supersedes 0004; `createStore`/`lib/store.ts` deleted) | accepted |
| [0038](0038-storage-backend-swappable-at-runtime.md) | Storage backend swappable at runtime — local baseline + remote, connection swaps it, re-hydrate (no reload) | accepted |
| [0039](0039-account-local-store-and-connection-lifecycle.md) | `account` — the lone local store, connection lifecycle, renderer-side memory tool tier | accepted |
| [0040](0040-knowledge-remote-service.md) | `apps/knowledge` — the remote service (Hono + MariaDB + OpenSearch + Inngest; auth; `/data` + `/kb` + `/inngest`) | accepted |
| [0041](0041-knowledgebase-plane.md) | Knowledgebase — all-OpenSearch, nested chunks, hybrid sparse+dense, fire-and-forget ingest | accepted |
| [0042](0042-unified-settings-registry.md) | Unified Settings registry — providers/models/services, `config.llm` derived, media subsumed (refines 0018) | accepted |

## Needs review / important missing parts

Decisions or gaps that are recorded but **not settled** — revisit before the
related area grows. Resolving one means writing/superseding an ADR and removing
it from this list.

| Item | Where recorded | What's missing |
| --- | --- | --- |
| Workspace isolation (`worktree`) | [ADR-0016](0016-workspace-isolation-field.md) | The entire concept: worktree lifecycle, merge-back, non-git workspaces. Field is settable but read by nothing. |
| Storage quota warning | [ADR-0012](0012-sessions-dual-tier-persistence.md) | Manual pruning shipped (Settings → Storage: per-workspace/session usage + delete). Still missing: a user-facing warning when a persist write fails (today it's only a logged `persist_failed`). |
| Video job orphaning on cancel/quit | [ADR-0014](0014-stop-semantics-and-tool-cancellation.md) | Stop ends polling but the server job keeps running; no job-id persistence for resume or cleanup (endpoint has no cancel API). |
| Bridge startup handshake | [ADR-0002](0002-typed-ipc-bridge.md) | 12 IPC channels now (was 6 when "revisit if it grows" was written); a missing handler still hangs the invoke silently. A startup ping would catch it. |
| Tests/typecheck not in CI | conventions/testing.md | `.github/workflows/review.yml` runs the reviewer gate only; nothing runs `pnpm typecheck` / `pnpm test` on push. |

Resolved since first written: reasoning config beyond OpenAI-compatible
(ADR-0006 — effort now maps to all three providers), the `lib/` → `core/`
migration tail (settings/media/agents moved to `core/`), conventions upstream
sync (copied to the reviewer repo), desktop storage quota ceiling (ADR-0017),
storage growth pruning (manual, Settings → Storage), and the `Session.steps`
progress DAG (removed — ToolCard links + live child sessions are the progress
view, ADR-0022), and client-side media downscaling (per-model pixel cap,
stored copy is the downscaled one — ADR-0027), and the account "Connected" mode
(now designed and built — the `account` store + connection lifecycle in
ADR-0039, with `apps/knowledge` as the backend in ADR-0040).
