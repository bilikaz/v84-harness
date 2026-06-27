# ADR-0065: Per-service priority pools + per-model concurrency caps

Status: Accepted
Date: 2026-06-26
Refines [ADR-0042](0042-unified-settings-registry.md) (the unified Settings registry — `services`
shape + derived `config.llm`). Feeds [ADR-0066](0066-concurrency-runner.md) (the runner that leases
over these pools). Present-tense map: [architecture/runner.md](../architecture/runner.md).

## Context

ADR-0042 made `services` map each service to **one** `{providerId, modelId}`. A single model per
service can't express two things this session needed:

1. **Spread across providers.** If three providers can read images, only one is ever used — the
   assignment. There's no way to say "use all of them."
2. **A concurrency unit.** Nothing on a model bounds how many calls may be in flight on it, so
   sub-agent fan-out ([ADR-0060](0060-async-subagent-delivery.md)) could overrun a local LLM's KV
   cache (the "Local-LLM prefill/eviction" needs-review item).

## Decision

**Every service is an ordered priority pool, and every model carries its own concurrency cap.**

- **`services: Record<ModelService, ModelAssignment[]>`** — an ordered list per service, **position =
  priority**. Membership = the model may serve the service.
- **`subAgent`** is a new `ModelService` (text modality, alongside `main`) — the child-runner pool.
  `main` (foreground) and `subAgent` (children) are the two text-runner roles.
- **`Model` gains** `c` (max concurrent in-flight calls, default 5), `reserve` (slots kept main-only
  on a model that serves **both** `main` and `subAgent` — sizes main's headroom, default 2), and
  `rating` (an optional ordering hint).
- **Derivation.** `resolveConfig` still returns each service's **primary** (the pool head) into
  `config.llm`, so every existing single-target reader is untouched. A new `resolvePools()` writes the
  full ordered pool — `{ providerId, modelId, config, c, reserve }` per entry — to `core/config/pools.ts`
  for the runner; `reserve` is non-zero only for a model present in **both** the `main` and `subAgent`
  lists.
- **Lending is explicit membership.** A model lends to children iff it's in the `subAgent` list;
  `reserve` only sizes the main-only headroom on such a shared model. (This is the settled answer to
  the design's reserve-vs-checkbox fork.)
- **Editing.** The `subAgent` + media pools are orderable lists in ModelsSection → Use cases; the chat
  screen keeps ownership of the `main` primary (provider/model/knobs).

## Consequences

- Any service can fan across several providers, highest-priority-with-capacity first, spilling down —
  "use all three image providers" is now expressible.
- `c` is the universal per-model concurrency unit the runner enforces ([ADR-0066](0066-concurrency-runner.md)).
- Backward compatible: primaries keep `config.llm` single-valued, so media tools / naming / resolution
  paths need no change. No data migration (the app is pre-release).
- Trade-off: `main` is touched in two places — the chat screen (primary + knobs) and the Use-cases
  order. Accepted; the primary stays chat-managed, and multiple distinct `main` *models* aren't
  surfaced in the UI yet (multiple main *instances* come from `c`).
