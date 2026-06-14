# ADR-0031: Config as the sole source of truth — domains under one roof, owners push

Status: Proposed
Date: 2026-06-14

## Context

Model data lived in shapes scattered across the layers it was *consumed* from.
ADR-0030 unified the per-entry shape (`CallTarget {provider, model}`) and put it
in the stores, but the call target lived in the llm layer (`llm/types.ts`), the
keyed map was a tools type (`ModelTargets` in `core/tools/types.ts`), and the app
tunables were a third thing (`AppConfig`). Each consumer reached for config its
own way — `getAppConfig()` inside a tool, `toolConfigSnapshot()` in the driver,
nested store reads in the UI — and re-assembled it ad hoc. There was no single
object that *was* the config; there were functions that rebuilt it on demand.
Every new consumer invented another access path, and the shapes drifted (a media
map here, a `ModelTargets` there, structurally identical, separately named).

## Decision

`config/` **owns** the configuration and is its **sole source of truth**. It is a
passive holder: it knows nothing of how values arrived or get updated — the
parties that own the editable settings push into it; everyone else reads.

One aggregate, one accessor:

```ts
// config/index.ts — the hub
interface Config { app: ConfigApp; llm: ConfigLLMList }
function getConfig(): Config            // { app: getAppConfig(), llm: getConfigLLMList() }
```

Config owns its vocabulary and its per-domain types, named for what they are
(not "a type of the llm layer" or "a tools type"):

- **`config/app.ts`** — `ConfigApp` (tunables: media caps, gen quality, session
  reserves), `getAppConfig()`, overrides loader. Pure-data defaults stay in
  `config/defaults.ts` so main and renderer read the same values.
- **`config/llm.ts`** — `ConfigLLM` (one provider+model entry, **the** call
  target — renamed from `CallTarget`, ADR-0030), `ConfigLLMList`
  (`Partial<Record<ConfigModelService, ConfigLLM>>`), and the service vocabulary
  `CONFIG_MODEL_SERVICES` / `ConfigModelService` (was `ModelService`, owned by
  the llm layer). The llm layer re-exports `ConfigLLM` for ergonomic import; the
  definition is config's.

The owners push, config never pulls:

- `settings.ts` owns the `main` slot → `syncMainToConfigLLM()` (write now +
  subscribe).
- `media.ts` owns the media slots → `syncMediaToConfigLLM()`.
- `config/llm.ts` exposes `writeConfigLLM(patch)` (merge; undefined clears).
  `config.llm` is **transient** (in-memory): it is a projection rebuilt from the
  owners' persisted stores at init, never persisted itself — a flat read-model
  can't reconstruct the normalized editable registry, so persisting it would be
  a cache that can lie.

Dependencies point **into** config. It imports leaf vocabulary only; the owning
stores and consumers import config, never the reverse.

This **supersedes the naming/ownership clause of ADR-0030**: the end-to-end
single shape stands, but the type is `ConfigLLM` defined in config (not
`CallTarget` in the llm layer), and `config` — not the individual stores — is the
canonical thing consumers read.

## Consequences

- One question — "what's configured?" — has one answer: `getConfig()`. New
  domains join as new keys under `Config` (the unification is a trajectory:
  more subsystems wire into config over time).
- `ModelTargets` and the standalone `getCallTarget` helper are deleted —
  `config.llm` is a plain keyed map; consumers index it directly.
- The renderer holds secrets in its stores; `config.llm` is the resolved
  read-model. Crossing to another process means serializing the projection
  (see ADR-0032), not sharing the stores.
- Config carries no resolution/derivation logic about *sources* — that lives in
  the owners. Keeps config a destination, testable in isolation.
