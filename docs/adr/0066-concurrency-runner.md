# ADR-0066: The concurrency runner — turn-held slot leases + provider affinity

Status: Accepted
Date: 2026-06-26
Builds on [ADR-0065](0065-per-service-priority-pools.md) (the pools it leases over). Refines
[ADR-0028](0028-llm-client-service-calls.md) / [ADR-0032](0032-ctx-main-data-carrier.md) (the llm
client + `ctx`) and [ADR-0060](0060-async-subagent-delivery.md) (async fan-out). Resolves the
"Local-LLM prefill/eviction kills long & resumed runs" needs-review item — the **app** half; the
server keep-alive ping is the operator half. Present-tense map: [architecture/runner.md](../architecture/runner.md).

## Context

Sub-agent fan-out put unbounded concurrent load on the model endpoint: N children + the parent could
exceed a local server's eviction-proof budget (`max_num_seqs × max_model_len ≤ KV pool`), so cached
prefixes got evicted and re-prefilled, or the SSE stream reset mid-response. Resume re-prefilled the
full context, and global per-call resolution meant a session could hop providers and lose its warm
prefix. ADR-0065 gave us per-model `c` and per-service pools; this ADR is the runtime that enforces
and routes over them.

## Decision

**A runner (`ctx.runner`, `core/runner/`) leases live slots over the pools; a binding keeps provider
affinity separately.** Two ideas kept distinct: a **slot** is live concurrency; a **binding** is a
provider preference that holds no slot.

- **Turn-held leases.** A turn acquires once at start — `runner.acquire(role, sid, contextSize,
  {signal})`, role `main`/`subAgent` from `isChild` — holds the slot across the **whole** ReAct loop
  (so it never re-contends mid-task and every step hits the same provider, KV-warm), and releases in
  `finally` (and on delete via `drop`). A held lease counts 1 against the model's `c`; sub-agents are
  additionally bounded by the **open band** (`c − reserve`), `main` may use the full `c`. Over
  capacity, the acquirer **queues** (FIFO, with a bound-favored pass) and the sidebar shows a
  "waiting for a slot" dot.
- **Provider affinity (binding).** `sessionId → provider`, kept for a TTL (`session.runnerTtlMs`,
  default 10 min) and holding **no slot**. A returning session prefers its bound provider so the KV
  cache hits, and wins that provider's freeing slot on ties. When the bound provider is full: a
  context **≥ `session.kvProtectThreshold`** (default 16k tokens) waits for it (re-routing would
  re-prefill the whole context); a smaller one **roams** to the next free model, priority-first. Past
  the TTL (KV gone), it roams.
- **Universal `c`.** Target-less calls (media gen/rec, naming, compaction) lease a **transient,
  no-affinity** slot via an injected `SlotProvider` — defined in `llm/` (so the llm layer never imports
  `core/`, same shape as `LLMConfigResolver`), implemented by `ctx` over the runner. The call
  priority-fills its pool, obeys `c`, releases per call; an empty pool falls back to the resolver. A
  turn passes its leased target into `call({ target })` directly.
- **No nested-sync case.** Children can't spawn sub-agents (`childSafe = false`, [ADR-0050](0050-engine-tool-tier.md)),
  so a parked parent can't deadlock a pool waiting on a grandchild — turn-level hold is sufficient,
  no parked-release needed.

## Consequences

- The app never generates more concurrent load than `c` per model — the eviction/thrash half of the
  TODO is closed once the operator sets each `c` to the server's budget; the CF-side keep-alive ping
  covers stream/connection liveness (the operator lever the TODO carved out). The two halves are
  complementary, not redundant.
- Returning/resumed sessions stay KV-warm via affinity instead of re-routing; the binding TTL ≈ the
  eviction window the TODO described.
- No idle squatting: finished/parked work frees its slot immediately, so a fresh session is never
  blocked by agents that stopped working.
- `llm/` stays decoupled from `core/` — the runner reaches `call()` only through the injected
  `SlotProvider`, mirroring the `LLMConfigResolver` seam (ADR-0028).
- **Still open:** bounding a child's context **growth** ([ADR-0058](0058-conversational-sub-agent-orchestration.md)'s
  lever) is now an optimization, not a fix for a live failure. Tracked in [/TODO.md](../../TODO.md).
