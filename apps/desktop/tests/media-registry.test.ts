// The media model registry: the legacy single-config migrates losslessly into
// one Cosmos entry covering both generation slots, slots auto-fill from
// capabilities without ever overriding a user's pick, and tools resolve
// strictly by assignment — an unassigned or endpoint-less slot resolves null
// (tool inert), never "whatever entry exists".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "v84-harness:media";

// Node has no localStorage; the registry's load() runs at module init, so the
// stub must exist BEFORE the dynamic import (vi.resetModules gives each test a
// fresh module + store state).
function stubStorage(seed?: object): void {
  const m = new Map<string, string>(seed ? [[KEY, JSON.stringify(seed)]] : []);
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

async function loadRegistry(seed?: object): Promise<typeof import("../src/core/media.ts")> {
  stubStorage(seed);
  return await import("../src/core/media.ts");
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("legacy migration", () => {
  it("turns the v1 single config into one Cosmos entry assigned to both generation slots", async () => {
    const media = await loadRegistry({
      baseUrl: "http://gen:8000/v1",
      apiKey: "k",
      model: "cosmos-predict2",
      maxSize: "1280x1280",
      models: ["cosmos-predict2"],
    });
    const reg = media.getMediaRegistry();
    expect(reg.entries).toHaveLength(1);
    const e = reg.entries[0];
    expect(e.capabilities).toEqual(["imageGen", "videoGen"]);
    expect(e.api).toBe("openai-images");
    expect(e.promptStyle).toBe("cosmos-json");
    expect(e.maxSize).toBe("1280x1280");
    expect(reg.assignments).toEqual({ imageGen: e.id, videoGen: e.id });
    expect(media.resolveMediaProvider("imageGen")?.baseUrl).toBe("http://gen:8000/v1");
    expect(media.resolveMediaProvider("imageRec")).toBeNull();
  });

  it("ignores a legacy config with no baseUrl (nothing was configured)", async () => {
    const media = await loadRegistry({ baseUrl: "", model: "x" });
    expect(media.getMediaRegistry().entries).toHaveLength(0);
  });

  it("passes a registry-shaped store through untouched", async () => {
    const media = await loadRegistry({
      entries: [{ id: "a", label: "rec", baseUrl: "http://rec/v1", capabilities: ["imageRec"], api: "openai-chat" }],
      assignments: { imageRec: "a" },
    });
    expect(media.resolveMediaProvider("imageRec")?.label).toBe("rec");
  });
});

describe("assignments", () => {
  it("auto-assigns an empty slot when an entry gains the capability, and clears it when lost", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { baseUrl: "http://rec/v1", api: "openai-chat", capabilities: ["imageRec"] });
    expect(media.getMediaRegistry().assignments.imageRec).toBe(id);
    expect(media.resolveMediaProvider("imageRec")?.id).toBe(id);

    media.updateMediaModel(id, { capabilities: [] });
    expect(media.getMediaRegistry().assignments.imageRec).toBeUndefined();
  });

  it("never overrides an existing pick when a second candidate appears", async () => {
    const media = await loadRegistry();
    const first = media.addMediaModel();
    media.updateMediaModel(first, { baseUrl: "http://a/v1", capabilities: ["imageGen"] });
    const second = media.addMediaModel();
    media.updateMediaModel(second, { baseUrl: "http://b/v1", capabilities: ["imageGen"] });
    expect(media.getMediaRegistry().assignments.imageGen).toBe(first);

    media.assignMediaModel("imageGen", second);
    expect(media.resolveMediaProvider("imageGen")?.id).toBe(second);
  });

  it("clears a slot on explicit unassign and on entry removal", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { baseUrl: "http://a/v1", capabilities: ["imageGen", "videoGen"] });

    media.assignMediaModel("imageGen", "");
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
    expect(media.resolveMediaProvider("videoGen")?.id).toBe(id);

    media.removeMediaModel(id);
    expect(media.getMediaRegistry().entries).toHaveLength(0);
    expect(media.resolveMediaProvider("videoGen")).toBeNull();
  });

  it("does not resolve an entry that has no endpoint yet", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { capabilities: ["imageGen"] }); // assigned, but baseUrl empty
    expect(media.getMediaRegistry().assignments.imageGen).toBe(id);
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
  });

  it("resolveMediaProviders maps only usable slots", async () => {
    const media = await loadRegistry();
    const gen = media.addMediaModel();
    media.updateMediaModel(gen, { baseUrl: "http://gen/v1", capabilities: ["imageGen", "videoGen"] });
    const rec = media.addMediaModel();
    media.updateMediaModel(rec, { capabilities: ["imageRec"] }); // no baseUrl → unusable
    const map = media.resolveMediaProviders();
    expect(Object.keys(map).sort()).toEqual(["imageGen", "videoGen"]);
    expect(map.imageGen?.id).toBe(gen);
  });
});
