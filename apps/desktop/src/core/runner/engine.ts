// The concurrency runner — leases live slots over the per-service priority pools, with
// reserve headroom, provider affinity (binding) for KV warmth, a wait queue, and a TTL.
// Framework-free: the clock, id source, pool snapshot, settings, and event sink are all
// injected, so it unit-tests without React or a real bus. See implementation.md.
//
// Two acquisition shapes share ONE per-model in-flight counter (the universal `c`):
//   • text turns (main / subAgent) — affinity on, held across the whole turn (KV-warm);
//   • everything else (media gen/rec, naming, compaction) — affinity off, held for the
//     single call. Both priority-fill their service's pool, top tier first.

import type { LLMConfig } from "../config/llm.ts";
import type { ModelService } from "../../llm/types.ts";
import { modelKey, type RunnerPools, type RunnerSlot } from "../config/pools.ts";

// The two text-runner roles — the services whose pools carry reserve + affinity.
export type RunnerRole = "main" | "subAgent";

// A held slot: identity (`id` — the surfaced slot token), the model it pins to, and the
// resolved target to call. A text turn reuses it across steps; a call holds it once.
export interface Lease {
  id: string;
  sessionId: string;
  service: ModelService;
  modelKey: string;
  config: LLMConfig;
}

export type RunnerEvent =
  | { type: "waiting"; sessionId: string; leaseId: string }
  | { type: "granted"; sessionId: string; leaseId: string; modelKey: string }
  | { type: "released"; sessionId: string; leaseId: string };

export interface AcquireOpts {
  affinity?: boolean; // keep a provider binding for KV warmth (text turns); default by service
  signal?: AbortSignal;
}

export interface RunnerDeps {
  pools: () => RunnerPools;
  ttlMs: () => number;
  kvThreshold: () => number;
  now?: () => number;
  emit?: (e: RunnerEvent) => void;
  newId?: () => string;
  // When set, a periodic pump so a warm waiter past its binding TTL roams even with no release
  // event in flight. Omitted in tests (which drive pump() by hand against a fake clock).
  reaperMs?: number;
}

interface Binding {
  modelKey: string;
  expiresAt: number;
}
interface Counts {
  total: number;
  child: number;
}
interface Waiter {
  id: string;
  service: ModelService;
  affinity: boolean;
  contextSize: number;
  preferredKey?: string; // a warm bound provider to wait on (favored); undefined = roam any
  deadline: number; // past this, a warm waiter roams freely (its binding TTL)
  leaseId: string;
  resolve: (lease: Lease | null) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const affinityDefault = (service: ModelService): boolean => service === "main" || service === "subAgent";

export class RunnerEngine {
  private readonly counts = new Map<string, Counts>(); // modelKey → live in-flight
  private readonly bindings = new Map<string, Binding>(); // acquirer id → provider affinity
  private readonly live = new Map<string, Lease>(); // acquirer id → currently held lease
  private readonly queue: Waiter[] = [];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    if (deps.reaperMs) setInterval(() => this.pump(), deps.reaperMs);
  }

  private emit(e: RunnerEvent): void {
    this.deps.emit?.(e);
  }
  private poolFor(service: ModelService): RunnerSlot[] {
    return this.deps.pools()[service] ?? [];
  }
  private cnt(key: string): Counts {
    return this.counts.get(key) ?? { total: 0, child: 0 };
  }

  // A slot has a free seat for this service: under its cap, and for sub-agents under its open band.
  private free(slot: RunnerSlot, service: ModelService): boolean {
    const cur = this.cnt(modelKey(slot));
    if (cur.total >= slot.c) return false;
    // clamp: a stored reserve > c would make the band negative and silently block every child on this model.
    if (service === "subAgent" && cur.child >= Math.max(0, slot.c - slot.reserve)) return false;
    return true;
  }

  // Acquire a slot for `id` on `service`'s pool. Reuses a still-held lease; otherwise runs the
  // warm/cold placement (see the acquire flowchart). Resolves null when aborted while queued, or
  // when the pool is empty (caller falls back). `contextSize` gates warm-wait vs roam.
  acquire(service: ModelService, id: string, contextSize = 0, opts: AcquireOpts = {}): Promise<Lease | null> {
    const held = this.live.get(id);
    if (held) return Promise.resolve(held);

    const affinity = opts.affinity ?? affinityDefault(service);
    const pool = this.poolFor(service);
    if (!pool.length) return Promise.resolve(null);

    const binding = affinity ? this.bindings.get(id) : undefined;
    const warm = binding && binding.expiresAt > this.now() ? binding.modelKey : undefined;

    if (warm) {
      const bound = pool.find((s) => modelKey(s) === warm);
      if (bound) {
        if (this.free(bound, service)) return Promise.resolve(this.grant(bound, id, service, affinity));
        // bound full: a big context waits on it (KV worth protecting); a small one roams.
        if (contextSize >= this.deps.kvThreshold()) return this.wait(service, id, affinity, contextSize, warm, binding!.expiresAt, opts.signal);
      }
    }

    // Cold, or a small warm session that's roaming: priority-fill, top of the pool first.
    const slot = pool.find((s) => this.free(s, service));
    if (slot) return Promise.resolve(this.grant(slot, id, service, affinity));
    return this.wait(service, id, affinity, contextSize, undefined, this.now(), opts.signal);
  }

  // Release a held slot (turn end / parking, or a call settling). A text binding is kept and its
  // TTL refreshed so a return re-warms the same provider; then the queue is pumped.
  release(id: string): void {
    const lease = this.live.get(id);
    if (!lease) return;
    this.live.delete(id);
    const cur = this.cnt(lease.modelKey);
    this.counts.set(lease.modelKey, { total: Math.max(0, cur.total - 1), child: Math.max(0, cur.child - (lease.service === "subAgent" ? 1 : 0)) });
    if (this.bindings.has(id)) this.bindings.set(id, { modelKey: lease.modelKey, expiresAt: this.now() + this.deps.ttlMs() });
    this.emit({ type: "released", sessionId: lease.sessionId, leaseId: lease.id });
    this.pump();
  }

  // Acquirer gone: drop its live lease, binding, and any queued waiter.
  drop(id: string): void {
    this.release(id);
    this.bindings.delete(id);
    const w = this.queue.find((x) => x.id === id);
    if (w) {
      this.removeWaiter(w);
      w.resolve(null);
    }
  }

  // Try to satisfy waiters against current free capacity. A warm waiter holds out for its bound
  // provider until its deadline, then roams. The TTL reaper calls this so deadline-expired waiters
  // roam even with no release event.
  pump(): void {
    for (;;) {
      const now = this.now();
      const boundFree = (w: Waiter): RunnerSlot | undefined => {
        if (!(w.preferredKey && now < w.deadline)) return undefined;
        const bound = this.poolFor(w.service).find((s) => modelKey(s) === w.preferredKey);
        return bound && this.free(bound, w.service) ? bound : undefined;
      };
      // Pass 1 — a warm waiter whose bound provider is free wins, wherever it sits (favoring).
      let idx = this.queue.findIndex((w) => boundFree(w));
      // Pass 2 — FIFO over the rest, but a warm waiter still within its deadline keeps holding
      // out for its (busy) bound provider rather than roaming.
      if (idx < 0)
        idx = this.queue.findIndex((w) => {
          const pool = this.poolFor(w.service);
          if (w.preferredKey && now < w.deadline && pool.some((s) => modelKey(s) === w.preferredKey)) return false;
          return pool.some((s) => this.free(s, w.service));
        });
      if (idx < 0) return;
      const w = this.queue[idx];
      const slot = boundFree(w) ?? this.poolFor(w.service).find((s) => this.free(s, w.service));
      if (!slot) return;
      this.queue.splice(idx, 1);
      if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
      w.resolve(this.grant(slot, w.id, w.service, w.affinity, w.leaseId));
    }
  }

  // ── introspection (UI + tests) ──────────────────────────────────────────────
  inflight(key: string): Counts {
    return this.cnt(key);
  }
  waitingCount(): number {
    return this.queue.length;
  }
  isWaiting(id: string): boolean {
    return this.queue.some((w) => w.id === id);
  }

  private grant(slot: RunnerSlot, id: string, service: ModelService, affinity: boolean, leaseId?: string): Lease {
    const key = modelKey(slot);
    const cur = this.cnt(key);
    this.counts.set(key, { total: cur.total + 1, child: cur.child + (service === "subAgent" ? 1 : 0) });
    const lease: Lease = { id: leaseId ?? this.newId(), sessionId: id, service, modelKey: key, config: slot.config };
    this.live.set(id, lease);
    if (affinity) this.bindings.set(id, { modelKey: key, expiresAt: this.now() + this.deps.ttlMs() });
    this.emit({ type: "granted", sessionId: id, leaseId: lease.id, modelKey: key });
    return lease;
  }

  private wait(service: ModelService, id: string, affinity: boolean, contextSize: number, preferredKey: string | undefined, deadline: number, signal?: AbortSignal): Promise<Lease | null> {
    return new Promise<Lease | null>((resolve) => {
      if (signal?.aborted) return resolve(null);
      const leaseId = this.newId();
      const w: Waiter = { id, service, affinity, contextSize, preferredKey, deadline, leaseId, resolve, signal };
      w.onAbort = () => {
        this.removeWaiter(w);
        resolve(null);
      };
      signal?.addEventListener("abort", w.onAbort, { once: true });
      this.queue.push(w);
      this.emit({ type: "waiting", sessionId: id, leaseId });
    });
  }

  private removeWaiter(w: Waiter): void {
    const i = this.queue.indexOf(w);
    if (i >= 0) this.queue.splice(i, 1);
    if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
  }
}
