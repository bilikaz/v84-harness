# ADR-0010: Adopt the shared conventions set

Status: accepted
Date: 2026-06-10

## Context

The reviewer project (`@bilikaz/code-reviewer`) distilled its engineering rules into a
portable, project-agnostic conventions set designed to be copied into other repos.
This harness had grown its own conventions organically (ADR-0001…0009 plus a
"code-level conventions" section in ARCHITECTURE.md); comparing the two showed broad
agreement, a handful of gaps on our side, and one principle that doesn't fit this
codebase.

## Decision

The shared rules live in [docs/conventions/](../conventions/) — one topic per file,
copied verbatim from the source set. This ADR adopts the whole set for this
repository:

[naming](../conventions/naming.md) ·
[types-placement](../conventions/types-placement.md) ·
[consolidation](../conventions/consolidation.md) ·
[error-handling](../conventions/error-handling.md) ·
[configuration](../conventions/configuration.md) ·
[logging](../conventions/logging.md) ·
[testing](../conventions/testing.md) ·
[documentation](../conventions/documentation.md)

Adoption changes applied with this ADR:

- `lib/errors.ts` provides `errorMessage(e: unknown)`; the `(e as Error)` cast is
  banned (error-handling rule 1).
- `core/tools/types.ts` holds the tool contract; `core/tools/shared.ts` keeps only
  cross-cutting helpers (types-placement: a contract never lives in `shared.ts`).
- `providers/client.ts` is the consumer-facing LLM API; `providers/index.ts` is a
  barrel (naming rules 4–5).
- Chat domain types (`Session`, `Message`, …) are defined in
  `core/sessions/types.ts` (the producer) and re-exported where consumers already
  import them (the producer-defines / port-re-exports rule).
- `lib/logger/` provides the `Logger` port with scoped children (`ConsoleLogger`,
  `MemoryLogger`); engine services log structured events instead of raw `console.*`.
- Vitest is the test runner; the first suites cover pure logic (path confinement,
  provider URL building, data-URL parsing) per the testing rules.

## Deviations (recorded, not edits to the shared rules)

- **Ctx DI container (the reviewer's ADR-0001) is NOT adopted.** It fits a one-shot
  CLI building a context once and threading it through stages. This is a long-lived
  reactive app: store modules are the dependency mechanism, the driver deliberately
  reads fresh state per turn, and React consumes the same stores via hooks. The
  *corollary* we do keep: configuration reads are centralized (typed store modules;
  the only env reads are `import.meta.env.DEV` as the default debug gate in
  `providers/debug.ts` / `lib/logger/console.ts` and electron-vite's
  `ELECTRON_RENDERER_URL` in `main/index.ts` — runtime wiring and presentation,
  not configuration).
- **Logging rule 5 (stderr/stdout split) doesn't apply** — there is no consumed
  stdout in a desktop app; the console sink writes to the DevTools console.
- **`main/index.ts` bootstrap may use bare `console`** — it runs before any wiring
  exists, in the main process (mirrors the reviewer's own mock-provider exception).
- **Exit-code rule (error-handling rule 5) doesn't apply** — not a CLI gate.
- **`pages/workspace/Sidebar.tsx` `window.prompt` fallback** stays untranslated and
  primitive — web mode is a dev convenience (ADR-0001 of this repo).
- **`core/sessions/store.ts` custom persistence** remains the sanctioned deviation
  from the store factory (this repo's ADR-0004).

## Consequences

- Convention changes edit one topic file in `docs/conventions/`; this ADR stays
  valid as the adoption record. Deviations are listed here, never patched into the
  shared rules.
- ARCHITECTURE.md keeps only repo-specific conventions and links to the shared set.
- The reviewer and the harness now share one rule vocabulary — relevant for the
  company knowledgebase / standards pipeline both feed into.
