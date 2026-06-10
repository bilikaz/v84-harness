// The storage port (ADR-0017): detection falls through best-first, and the
// last-resort adapter honors the port contract. In this node environment there
// is no bridge and no IndexedDB, so detection must land on localStorage.
import { beforeEach, describe, expect, it } from "vitest";

import { detectStorage, LocalStorage } from "../src/lib/storage/index.ts";

beforeEach(() => localStorage.clear());

describe("detectStorage", () => {
  it("falls through to the localStorage adapter when sqlite/idb are unavailable", async () => {
    const storage = await detectStorage();
    expect(storage.name).toBe("local");
  });

  it("returns the same selection on every call (detection runs once)", async () => {
    const a = await detectStorage();
    const b = await detectStorage();
    expect(a).toBe(b);
  });
});

describe("LocalStorage adapter", () => {
  it("round-trips and deletes values under the port contract", async () => {
    const s = await LocalStorage.create();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v1");
    expect(await s.get("k")).toBe("v1");
    await s.set("k", "v2");
    expect(await s.get("k")).toBe("v2");
    await s.del("k");
    expect(await s.get("k")).toBeNull();
  });
});
