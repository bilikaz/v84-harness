// The store kernel — the persistence + notify contract every store in the app
// builds on (ADR-0004). Configs come from real defaults per testing.md rule 5.
import { beforeEach, describe, expect, it } from "vitest";

import { createListeners, createStore } from "../src/lib/store.ts";

interface S {
  a: number;
  b: string;
}
const DEFAULTS: S = { a: 1, b: "x" };

beforeEach(() => localStorage.clear());

describe("createStore", () => {
  it("starts from defaults and persists set() under the key", () => {
    const store = createStore<S>("test:s", DEFAULTS);
    expect(store.get()).toEqual(DEFAULTS);
    store.set({ a: 2, b: "y" });
    expect(JSON.parse(localStorage.getItem("test:s")!)).toEqual({ a: 2, b: "y" });
  });

  it("merges persisted state over defaults on load (new fields keep defaults)", () => {
    localStorage.setItem("test:s", JSON.stringify({ a: 7 }));
    const store = createStore<S>("test:s", DEFAULTS);
    expect(store.get()).toEqual({ a: 7, b: "x" });
  });

  it("patch() shallow-merges and notifies subscribers", () => {
    const store = createStore<S>(null, DEFAULTS);
    let fired = 0;
    const off = store.subscribe(() => fired++);
    store.patch({ b: "z" });
    expect(store.get()).toEqual({ a: 1, b: "z" });
    expect(fired).toBe(1);
    off();
    store.patch({ a: 9 });
    expect(fired).toBe(1);
  });

  it("a null key is transient — nothing lands in localStorage", () => {
    const store = createStore<S>(null, DEFAULTS);
    store.set({ a: 5, b: "q" });
    expect(localStorage.length).toBe(0);
  });

  it("load() overrides the read entirely; null falls back to defaults", () => {
    localStorage.setItem("test:legacy", JSON.stringify({ a: 3, b: "old" }));
    const migrated = createStore<S>("test:s", DEFAULTS, () => {
      const raw = localStorage.getItem("test:s") ?? localStorage.getItem("test:legacy");
      return raw ? (JSON.parse(raw) as S) : null;
    });
    expect(migrated.get()).toEqual({ a: 3, b: "old" });

    const empty = createStore<S>("test:none", DEFAULTS, () => null);
    expect(empty.get()).toEqual(DEFAULTS);
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
