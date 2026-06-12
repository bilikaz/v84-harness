// The media model registry: older stored shapes migrate losslessly (v1 single
// config → one Cosmos entry on both generation slots; v2 capability-list
// entries → two-flavor entries, the shared maxSize split per modality),
// assignment IS the classification (slotCandidates filters by API type), and
// tools resolve strictly by assignment — an unassigned or endpoint-less slot
// resolves null (tool inert), never "whatever entry exists".
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

describe("migrations", () => {
  it("v1 single config → one Cosmos entry assigned to both generation slots", async () => {
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
    expect(e.api).toBe("openai");
    expect(e.promptStyle).toBe("cosmos-json");
    expect(e.maxImageSize).toBe("1280x1280");
    expect(e.maxVideoSize).toBe("1280x1280");
    expect(reg.assignments).toEqual({ imageGen: e.id, videoGen: e.id });
    expect(media.resolveMediaProvider("imageGen")?.baseUrl).toBe("http://gen:8000/v1");
    expect(media.resolveMediaProvider("imageRec")).toBeNull();
  });

  it("v1 with no baseUrl is ignored (nothing was configured)", async () => {
    const media = await loadRegistry({ baseUrl: "", model: "x" });
    expect(media.getMediaRegistry().entries).toHaveLength(0);
  });

  it("v2 entries: three-way flavors collapse to two, capabilities drop, maxSize splits", async () => {
    const media = await loadRegistry({
      entries: [
        { id: "a", label: "cosmos", baseUrl: "http://a/v1", capabilities: ["imageGen", "videoGen"], api: "openai-images", maxSize: "1280x1280" },
        { id: "b", label: "bansai", baseUrl: "http://b/", capabilities: ["imageGen"], api: "plain-generate" },
        { id: "c", label: "rec", baseUrl: "http://c/v1", capabilities: ["imageRec"], api: "openai-chat" },
      ],
      assignments: { imageGen: "b", videoGen: "a", imageRec: "c" },
    });
    const [a, b, c] = media.getMediaRegistry().entries;
    expect(a.api).toBe("openai");
    expect(a.maxImageSize).toBe("1280x1280");
    expect(a.maxVideoSize).toBe("1280x1280");
    expect(b.api).toBe("generate");
    expect(c.api).toBe("openai");
    expect("capabilities" in a).toBe(false);
    expect(media.resolveMediaProvider("imageGen")?.id).toBe("b");
    expect(media.resolveMediaProvider("imageRec")?.id).toBe("c");
  });
});

describe("classification by assignment", () => {
  it("slotCandidates filters by API type — bare /generate fits only image generation", async () => {
    const media = await loadRegistry();
    const open = media.addMediaModel();
    media.updateMediaModel(open, { baseUrl: "http://a/v1" }); // api defaults to openai
    const bare = media.addMediaModel();
    media.updateMediaModel(bare, { baseUrl: "http://b/", api: "generate" });

    const entries = media.getMediaRegistry().entries;
    expect(media.slotCandidates("imageGen", entries).map((e) => e.id)).toEqual([open, bare]);
    expect(media.slotCandidates("videoGen", entries).map((e) => e.id)).toEqual([open]);
    expect(media.slotCandidates("imageRec", entries).map((e) => e.id)).toEqual([open]);
  });

  it("assignment is explicit — nothing resolves until a slot is pointed at an entry", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { baseUrl: "http://a/v1" });
    expect(media.resolveMediaProvider("imageGen")).toBeNull();

    media.assignMediaModel("imageGen", id);
    expect(media.resolveMediaProvider("imageGen")?.id).toBe(id);

    media.assignMediaModel("imageGen", "");
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
  });

  it("an API-type change clears assignments the new type can't serve", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { baseUrl: "http://a/v1" });
    media.assignMediaModel("imageGen", id);
    media.assignMediaModel("imageRec", id);

    media.updateMediaModel(id, { api: "generate" });
    expect(media.getMediaRegistry().assignments.imageGen).toBe(id); // generate still fits imageGen
    expect(media.getMediaRegistry().assignments.imageRec).toBeUndefined();
  });

  it("removal clears every slot pointing at the entry", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel();
    media.updateMediaModel(id, { baseUrl: "http://a/v1" });
    media.assignMediaModel("imageGen", id);
    media.assignMediaModel("videoGen", id);

    media.removeMediaModel(id);
    expect(media.getMediaRegistry().entries).toHaveLength(0);
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
    expect(media.resolveMediaProvider("videoGen")).toBeNull();
  });

  it("does not resolve an entry that has no endpoint yet", async () => {
    const media = await loadRegistry();
    const id = media.addMediaModel(); // baseUrl empty
    media.assignMediaModel("imageGen", id);
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
  });

  it("resolveMediaProviders maps only usable slots", async () => {
    const media = await loadRegistry();
    const gen = media.addMediaModel();
    media.updateMediaModel(gen, { baseUrl: "http://gen/v1" });
    media.assignMediaModel("imageGen", gen);
    media.assignMediaModel("videoGen", gen);
    const empty = media.addMediaModel(); // no baseUrl → unusable
    media.assignMediaModel("imageRec", empty);

    const map = media.resolveMediaProviders();
    expect(Object.keys(map).sort()).toEqual(["imageGen", "videoGen"]);
    expect(map.imageGen?.id).toBe(gen);
  });
});
