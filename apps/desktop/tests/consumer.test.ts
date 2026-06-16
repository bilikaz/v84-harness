// Consumer kernel (ADR-0037) — the reactive + persist contract every domain store builds on,
// plus the bare createListeners primitive. Persistence rides the StorageEngine's settings repo
// (local provider) over an in-memory backend.
import { beforeEach, describe, expect, it } from "vitest";

import { Consumer, createListeners } from "../src/core/storage/consumer.ts";
import { StorageEngine } from "../src/core/storage/engine.ts";
import { memoryRepos } from "../src/core/storage/memory.ts";
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

const ctxWith = (): Ctx => ({ storage: new StorageEngine(memoryRepos()) }) as unknown as Ctx;

beforeEach(() => localStorage.clear());

describe("Consumer", () => {
  it("starts from defaults and commit() persists through the settings repo under the key", async () => {
    const ctx = ctxWith();
    const s = new TestStore(ctx, "test:s");
    expect(s.get()).toEqual(DEFAULTS);
    s.set({ a: 2, b: "y" });
    expect(s.get()).toEqual({ a: 2, b: "y" });
    await Promise.resolve(); // persist is fire-and-forget
    const row = await ctx.storage.localRepos().settings.get("test:s");
    expect(JSON.parse(String(row!.value))).toEqual({ a: 2, b: "y" });
  });

  it("hydrate() merges persisted state over defaults (new fields keep defaults)", async () => {
    const ctx = ctxWith();
    await ctx.storage.localRepos().settings.put({ key: "test:s", scope: "local", value: JSON.stringify({ a: 7 }) });
    const s = new TestStore(ctx, "test:s");
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
