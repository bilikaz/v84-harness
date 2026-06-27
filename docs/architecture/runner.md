# The concurrency runner

How the harness bounds and routes concurrent LLM calls so it never overruns a model
endpoint (especially a local LLM's finite KV cache). Decisions:
[ADR-0065](../adr/0065-per-service-priority-pools.md) (the pools) +
[ADR-0066](../adr/0066-concurrency-runner.md) (the runner). Sits between the sessions
engine / media tools and the llm client.

## Pools (config layer)

`Settings.services` is `Record<ModelService, ModelAssignment[]>` — an **ordered priority
pool** per service (`main`, `subAgent`, and the media services), position = priority.
Each `Model` carries `c` (max concurrent in-flight, default 5), `reserve` (main-only
headroom on a model serving both `main` and `subAgent`, default 2), and `rating` (an
ordering hint). On every settings change `Settings.notify()` derives two views:

- `config.llm[service]` — the **primary** (pool head), for all single-target readers
  (media tools' `canRun`, `resolveMain`, context display). Unchanged contract.
- `core/config/pools.ts` (`RunnerPools`) — the **full ordered pool** of
  `{ providerId, modelId, config, c, reserve }`, for the runner. `reserve` is non-zero
  only for a model in both the `main` and `subAgent` lists.

Editing: the `subAgent` + media pools are orderable in ModelsSection → Use cases; the
chat screen owns the `main` primary.

## The runner (`core/runner/`)

`ctx.runner` (a `RunnerEngine`, framework-free — clock/ids/pools/settings/event-sink
injected) tracks per-model in-flight counts, a `sessionId → provider` binding map, and a
wait queue.

- **Slot vs binding.** A *slot* is live concurrency, held only while working. A *binding*
  is a provider preference (TTL `session.runnerTtlMs`, default 10 min) that holds no slot —
  it steers a returning session back to its warm provider.
- **`acquire(service, id, contextSize, {affinity, signal})`** → `Lease | null`. Reuses a
  held lease; else: warm (bound) provider free → grant there; bound full + context ≥
  `session.kvProtectThreshold` (16k) → wait on it; else roam priority-first (top pool model
  with a free seat). Empty pool → `null` (caller falls back). `null` while a turn's signal
  aborted = a Stop. Free seat = `total < c`, and for `subAgent` also `child < c − reserve`.
- **`release(id)`** frees the slot, refreshes the binding TTL, pumps the queue.
  **`drop(id)`** clears lease + binding + any queued waiter (session delete).
- **Queue** — over capacity, acquirers wait; `pump()` grants warm-bound waiters first
  (favoring), then FIFO. A reaper (`reaperMs`) re-pumps so a warm waiter past its TTL roams.
- **Events** → `core/runner/status.ts` (a reactive waiting set) → the sidebar's sky-blue
  "waiting for a slot" dot.

## Wiring

- **Turn loop** ([sessions/engine.ts](../../apps/desktop/src/core/sessions/engine.ts)) —
  acquires at turn start (`role = isChild ? "subAgent" : "main"`), holds across all steps,
  passes `lease.config` as `call({ target })`, uses the leased model's `input` for
  history/feedback filtering, releases in `finally`. A null lease that isn't an abort
  (empty pool) falls back to the primary `main`.
- **Target-less calls** (media gen/rec, naming, compaction) — `client.call()` leases a
  transient, no-affinity slot through an injected `SlotProvider` (defined in `llm/`,
  implemented by `ctx` over the runner), so they obey `c` and priority-fill too; released in
  `finally`, empty pool falls back to the resolver.
- **Config** — `session.runnerTtlMs` + `session.kvProtectThreshold` in
  [config/defaults.ts](../../apps/desktop/src/core/config/defaults.ts), with controls in
  Settings → Configuration → Concurrency.

## Operator half

The app only governs the load it *generates* (`c` per model, set to the server's budget).
Keeping the in-flight stream/connection alive against proxy idle timeouts is the operator's
lever — handled server-side by a keep-alive ping. Both halves together close the
local-LLM eviction/reset problem.

## Still open

Bounding a child's context **growth** ([ADR-0058](../adr/0058-conversational-sub-agent-orchestration.md))
remains — now an optimization (cheaper re-prefill), not a fix for a live failure.
