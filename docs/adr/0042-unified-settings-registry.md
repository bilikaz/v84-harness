# ADR-0042: Unified Settings registry — providers / models / services; media subsumed

Status: Accepted
Date: 2026-06-15
Refines [ADR-0018](0018-capability-gated-media-tools.md) (the media *config* folds in here; the gated media tools themselves stand). Keeps [ADR-0031](0031-config-sole-source-of-truth.md)'s `config.llm` as the derived source. Built on [ADR-0037](0037-reactive-consumer-over-injected-storage.md).

## Context

Chat model settings and media model settings were two separate stores with
near-identical shapes (provider + model + knobs) and parallel sync code
(`syncMain` / `syncMedia` → `config.llm`). The framing this session: providers and
models are identical to today's settings; only "who serves what" differs. So
unify the data and let the two screens be views onto it.

## Decision

One `Settings` consumer holds **providers → models** plus a **services** map (a
per-`ModelService` assignment). `main` (the chat model) is just another service
alongside the media ones; `config.llm` is derived purely from `services`.

```ts
interface SettingsState { providers: Provider[]; services: Partial<Record<ModelService, ModelAssignment>> }
// Provider: id, name, api (dialect), baseUrl, apiKey?, detected[], modelLimits, models[]
// Model:    id (registry) + modelId (wire) + capabilities[] + chat knobs + media knobs (all optional)
// ModelAssignment: { providerId, modelId } — a service points at one registered model
```

- **`config.llm` is derived, not stored.** `notify()` re-resolves every service
  to an `LLMConfig` and `writeLLMConfig(slice)`, replacing the old per-screen
  sync. One model shape end to end ([ADR-0030](0030-unified-call-target.md)), no
  migrations.
- **The two screens are views onto one state.** ProviderSection edits the `main`
  service (synthesized to the flat `ChatModelSettings` shape — chat knobs,
  detected list, context limits); ModelsSection manages the registry + media
  service assignments. Compatibility aliases (`MediaProvider` / `MediaModel` /
  `MediaRegistry`) keep the media screen's vocabulary so the UI didn't have to
  change shape ("leave the current layout, rework the data structure").
- **`main` is privileged only where it must be.** It survives pruning without an
  explicit capability flag (a media slot requires its capability); chat detection
  uses the direct llm listing (which yields context lengths and `modelLimits`)
  rather than the host media-listing path.
- **Derived views are cached** (`chatCache` / `regCache`, cleared in `notify`) so
  the `useSyncExternalStore` hooks return a stable reference
  ([ADR-0037](0037-reactive-consumer-over-injected-storage.md)) — a fresh object
  per read loops.

## Consequences

- One registry, one persistence key, one derivation to `config.llm` — the
  parallel media store and its sync code are gone.
- Adding a model service = adding it to `ModelService` + `ALL_SERVICES`; the
  resolution, pruning, and slot-picker are all generic over that list.
- The UI kept its shape because the screens are thin views with the old
  vocabulary aliased — no screen rewrite was needed to land the data-model change.
- [ADR-0018](0018-capability-gated-media-tools.md)'s gated media *tools* are
  untouched; only the media model *configuration* moved into this registry.
