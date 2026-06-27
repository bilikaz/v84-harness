// The concurrency runner: cap + reserve enforcement, priority-fill, provider affinity,
// warm-wait vs small-roam against the KV threshold, TTL re-bind, and bound-favored queueing.
import { describe, it, expect } from "vitest";

import { RunnerEngine } from "../src/core/runner/engine.ts";
import type { RunnerPools, RunnerSlot } from "../src/core/config/pools.ts";

const slot = (providerId: string, c: number, reserve = 0): RunnerSlot => ({
  providerId,
  modelId: "m",
  config: { provider: { name: providerId, type: "openai", baseUrl: "http://x" }, model: {} },
  c,
  reserve,
});
const key = (providerId: string): string => `${providerId}:m`;

// A runner over a fixed pool snapshot with a controllable clock; ttl 1000, KV threshold 100.
function harness(pools: RunnerPools) {
  let t = 0;
  let n = 0;
  const engine = new RunnerEngine({
    pools: () => pools,
    ttlMs: () => 1000,
    kvThreshold: () => 100,
    now: () => t,
    newId: () => `id${n++}`,
  });
  return { engine, tick: (ms: number) => (t += ms) };
}

describe("cap", () => {
  it("holds at c and queues the overflow; releasing hands the slot to the waiter", async () => {
    const { engine } = harness({ main: [slot("A", 2)] });
    const a = await engine.acquire("main", "s1", 0);
    const b = await engine.acquire("main", "s2", 0);
    expect(a?.modelKey).toBe(key("A"));
    expect(b?.modelKey).toBe(key("A"));
    expect(engine.inflight(key("A")).total).toBe(2);

    const pending = engine.acquire("main", "s3", 0);
    expect(engine.isWaiting("s3")).toBe(true);

    engine.release("s1");
    expect((await pending)?.modelKey).toBe(key("A"));
    expect(engine.inflight(key("A")).total).toBe(2);
  });
});

describe("reserve", () => {
  it("caps children at the open band while main may use the whole cap", async () => {
    // Same model in both pools, c=5 reserve=2 → children get 3, main can fill to 5.
    const shared = slot("A", 5, 2);
    const { engine } = harness({ main: [shared], subAgent: [shared] });

    await engine.acquire("subAgent", "c1", 0);
    await engine.acquire("subAgent", "c2", 0);
    await engine.acquire("subAgent", "c3", 0);
    const c4 = engine.acquire("subAgent", "c4", 0);
    expect(engine.isWaiting("c4")).toBe(true); // 4th child blocked: open band (3) full
    expect(engine.inflight(key("A")).child).toBe(3);

    // main still has headroom up to c=5 (total now 3)
    const m1 = await engine.acquire("main", "m1", 0);
    const m2 = await engine.acquire("main", "m2", 0);
    expect(m1?.modelKey).toBe(key("A"));
    expect(m2?.modelKey).toBe(key("A"));
    expect(engine.inflight(key("A")).total).toBe(5);
    const m3 = engine.acquire("main", "m3", 0);
    expect(engine.isWaiting("m3")).toBe(true); // cap reached

    engine.release("c1");
    expect(await c4).toBeTruthy(); // freed child slot goes to the queued child
    void m3;
  });

  it("clamps a reserve > c to a zero band instead of a negative one (no phantom child seats)", async () => {
    // A misconfigured reserve once made the band (c − reserve) negative, so `cur.child >= band` was
    // always true and every child silently blocked. Clamped to 0: children blocked, main unaffected.
    const shared = slot("A", 2, 5); // reserve 5 > c 2
    const { engine } = harness({ main: [shared], subAgent: [shared] });

    const c1 = engine.acquire("subAgent", "c1", 0);
    expect(engine.isWaiting("c1")).toBe(true); // band is 0, not -3 → no child seat
    expect(engine.inflight(key("A")).child).toBe(0);

    const m1 = await engine.acquire("main", "m1", 0); // main still uses the full cap
    expect(m1?.modelKey).toBe(key("A"));
    void c1;
  });
});

describe("drop", () => {
  it("tears down a same-id waiter before release pumps, so no fresh lease escapes cleanup", async () => {
    // Double-acquire leaves one waiter live and one still queued under the same id. drop() must free
    // both; if release() pumped first, the queued twin would be granted a lease that then leaks.
    const { engine } = harness({ main: [slot("A", 1)] });
    await engine.acquire("main", "occupy", 0); // A full (total 1)
    const first = engine.acquire("main", "dup", 0); // queued (waiter 1)
    const second = engine.acquire("main", "dup", 0); // queued again, same id (waiter 2)
    expect(engine.isWaiting("dup")).toBe(true);

    engine.release("occupy"); // pump grants waiter 1 → "dup" live; waiter 2 still queued
    expect(await first).toBeTruthy();
    expect(engine.inflight(key("A")).total).toBe(1);

    engine.drop("dup");
    expect(engine.inflight(key("A")).total).toBe(0); // live lease freed, twin not re-granted
    expect(engine.isWaiting("dup")).toBe(false);
    expect(await second).toBeNull();
  });
});

describe("priority fill", () => {
  it("fills the top model first, spills to the next when it's saturated", async () => {
    const { engine } = harness({ main: [slot("A", 1), slot("B", 5)] });
    const a = await engine.acquire("main", "s1", 0);
    const b = await engine.acquire("main", "s2", 0);
    expect(a?.modelKey).toBe(key("A")); // top tier first
    expect(b?.modelKey).toBe(key("B")); // A full → spill down
  });
});

describe("affinity", () => {
  it("a returning session re-binds to its provider even when a higher tier is free", async () => {
    const { engine } = harness({ main: [slot("A", 1), slot("B", 1)] });
    await engine.acquire("main", "s1", 0); // A
    await engine.acquire("main", "s2", 0); // B
    engine.release("s1"); // A free, s1 bound to A
    engine.release("s2"); // B free, s2 bound to B
    const again = await engine.acquire("main", "s2", 0);
    expect(again?.modelKey).toBe(key("B")); // not A, though A is also free — stays warm
  });
});

describe("warm-wait vs roam", () => {
  it("a big context waits on its bound provider; a small one roams to the next tier", async () => {
    for (const [ctx, expected] of [
      [200, undefined],
      [10, key("B")],
    ] as const) {
      const { engine } = harness({ main: [slot("A", 1), slot("B", 5)] });
      await engine.acquire("main", "s1", 0); // A
      engine.release("s1"); // s1 bound to A
      await engine.acquire("main", "s2", 0); // A taken again (top, free) → A full

      const p = engine.acquire("main", "s1", ctx);
      if (expected === undefined) {
        expect(engine.isWaiting("s1")).toBe(true); // big context holds out for A
        expect(engine.inflight(key("B")).total).toBe(0); // did NOT roam to B
      } else {
        expect((await p)?.modelKey).toBe(expected); // small context roamed to B
      }
    }
  });
});

describe("TTL re-bind", () => {
  it("a warm waiter past its binding TTL roams instead of waiting forever", async () => {
    const { engine, tick } = harness({ main: [slot("A", 1), slot("B", 5)] });
    await engine.acquire("main", "s1", 0); // A (binding expires at t=1000)
    engine.release("s1");
    await engine.acquire("main", "s2", 0); // A full again
    const p = engine.acquire("main", "s1", 200); // big → waits on A
    expect(engine.isWaiting("s1")).toBe(true);
    tick(1500); // past the binding TTL → KV gone
    engine.pump();
    expect((await p)?.modelKey).toBe(key("B")); // roamed
  });
});

describe("queue favoring", () => {
  it("a freed slot goes to the waiter bound to it over an earlier cold waiter", async () => {
    const { engine } = harness({ main: [slot("A", 1)] });
    await engine.acquire("main", "warm", 0); // A
    engine.release("warm"); // warm bound to A
    await engine.acquire("main", "holder", 0); // A full again

    const cold = engine.acquire("main", "cold", 0); // queued first, no binding
    const warm = engine.acquire("main", "warm", 200); // queued second, bound to A
    expect(engine.isWaiting("cold")).toBe(true);
    expect(engine.isWaiting("warm")).toBe(true);

    engine.release("holder"); // A frees → warm (bound) wins despite cold being earlier
    expect((await warm)?.modelKey).toBe(key("A"));
    expect(engine.isWaiting("cold")).toBe(true);
    void cold;
  });
});
