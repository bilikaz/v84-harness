// Storage port (ADR-0017) — the LocalStorage adapter's get/set/del/keys contract.
// Adapter SELECTION moved into each host's init.ts (web vs electron), so there's no longer a portable
// detectStorage() to unit-test here; the contract below is the seam the StorageEngine builds on.
import { beforeEach, describe, expect, it } from "vitest";

import { LocalStorage } from "../src/web/localStorage.ts";

beforeEach(() => localStorage.clear());

describe("LocalStorage adapter", () => {
  it("identifies as the local backend", () => {
    expect(LocalStorage.create().name).toBe("local");
  });

  it("round-trips and deletes values under the port contract", async () => {
    const s = LocalStorage.create();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v1");
    expect(await s.get("k")).toBe("v1");
    await s.set("k", "v2");
    expect(await s.get("k")).toBe("v2");
    await s.del("k");
    expect(await s.get("k")).toBeNull();
  });

  it("lists keys by prefix", async () => {
    const s = LocalStorage.create();
    await s.set("p:a", "1");
    await s.set("p:b", "2");
    await s.set("other", "3");
    expect((await s.keys("p:")).sort()).toEqual(["p:a", "p:b"]);
  });
});
