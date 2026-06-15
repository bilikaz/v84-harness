// Consumer kernel (ADR-0037) — the reactive + persist-through-ctx.storage contract
// every domain store builds on, plus the bare createListeners primitive. Replaces
// the old lib/store.ts createStore factory (deleted). Persistence rides a real
// StorageEngine over the in-memory LocalStorage adapter (the port is the seam).
import { beforeEach, describe, expect, it } from "vitest";

import { Consumer, createListeners } from "../src/core/storage/consumer.ts";
import { StorageEngine } from "../src/core/storage/index.ts";
import { LocalStorage } from "../src/web/localStorage.ts";
import type { Ctx } from "../src/core/ctx.ts";

interface S {
  a: number;
  b: string;
}
const DEFAULTS: S = { a: 1, b: "x" };

// A concrete Consumer that exposes commit() so the base contract is testable.
class TestStore extends Consumer<S> {
  constructor(ctx: Ctx, key: string | null) {
    super(ctx, key, DEFAULTS);
  }
  set(next: S): void {
    this.commit(next);
  }
}

const ctxWith = (): Ctx => ({ storage: new StorageEngine(LocalStorage.create()) }) as unknown as Ctx;

beforeEach(() => localStorage.clear());

describe("Consumer", () => {
  it("starts from defaults and commit() persists through ctx.storage under the key", async () => {
    const s = new TestStore(ctxWith(), "test:s");
    expect(s.get()).toEqual(DEFAULTS);
    s.set({ a: 2, b: "y" });
    expect(s.get()).toEqual({ a: 2, b: "y" });
    await Promise.resolve(); // persist is fire-and-forget
    expect(JSON.parse(localStorage.getItem("test:s")!)).toEqual({ a: 2, b: "y" });
  });

  it("hydrate() merges persisted state over defaults (new fields keep defaults)", async () => {
    localStorage.setItem("test:s", JSON.stringify({ a: 7 }));
    const s = new TestStore(ctxWith(), "test:s");
    await s.hydrate();
    expect(s.get()).toEqual({ a: 7, b: "x" });
  });

  it("a null key is transient — nothing lands in localStorage", async () => {
    const s = new TestStore(ctxWith(), null);
    s.set({ a: 5, b: "q" });
    await Promise.resolve();
    expect(localStorage.length).toBe(0);
  });

  it("hydrate() on a null-key consumer resets to defaults (transient, never read back)", async () => {
    const s = new TestStore(ctxWith(), null);
    s.set({ a: 5, b: "q" });
    await s.hydrate();
    expect(s.get()).toEqual(DEFAULTS);
  });
});

describe("createListeners", () => {
  it("notifies every listener; unsubscribe stops only that one", () => {
    const reg = createListeners();
    const seen: string[] = [];
    const offA = reg.subscribe(() => seen.push("a"));
    reg.subscribe(() => seen.push("b"));
    reg.notify();
    offA();
    reg.notify();
    expect(seen).toEqual(["a", "b", "b"]);
  });
});
