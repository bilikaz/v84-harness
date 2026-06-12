// The provider/model registry: providers hold the connection, models hold
// capabilities; assignment points a use-case slot at one model and tools get
// the FLATTENED provider+model config. Older stored shapes (v1 single config,
// flat entries with/without capability lists) migrate losslessly. Assignments
// must stay honest: anything pointing at a removed model/provider or a lost
// capability is pruned, and an unassigned/endpoint-less slot resolves null
// (tool inert), never "whatever exists".
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
  it("v1 single config → one provider with one Cosmos model on both generation slots", async () => {
    const media = await loadRegistry({
      baseUrl: "http://gen:8000/v1",
      apiKey: "k",
      model: "cosmos-predict2",
      maxSize: "1280x1280",
      models: ["cosmos-predict2"],
    });
    const reg = media.getMediaRegistry();
    expect(reg.providers).toHaveLength(1);
    const p = reg.providers[0];
    expect(p.api).toBe("openai");
    expect(p.detected).toEqual(["cosmos-predict2"]);
    expect(p.models).toHaveLength(1);
    const m = p.models[0];
    expect(m.modelId).toBe("cosmos-predict2");
    expect(m.capabilities).toEqual(["imageGen", "videoGen"]);
    expect(m.promptStyle).toBe("cosmos-json");
    expect(m.maxImageSize).toBe("1280x1280");
    expect(m.maxVideoSize).toBe("1280x1280");
    const target = media.resolveMediaProvider("imageGen");
    expect(target?.provider.baseUrl).toBe("http://gen:8000/v1");
    expect(target?.model.id).toBe("cosmos-predict2");
    expect(media.resolveMediaProvider("imageRec")).toBeNull();
  });

  it("flat entries (capability-era) → one provider each, one model with the entry's capabilities", async () => {
    const media = await loadRegistry({
      entries: [
        { id: "a", label: "cosmos", baseUrl: "http://a/v1", capabilities: ["imageGen", "videoGen"], api: "openai-images", model: "cosmos-x", maxSize: "1280x1280", promptStyle: "cosmos-json" },
        { id: "b", label: "bansai", baseUrl: "http://b/", capabilities: ["imageGen"], api: "plain-generate" },
      ],
      assignments: { imageGen: "b", videoGen: "a" },
    });
    const reg = media.getMediaRegistry();
    expect(reg.providers.map((p) => p.api)).toEqual(["openai", "generate"]);
    expect(media.resolveMediaProvider("imageGen")?.provider.name).toBe("bansai");
    expect(media.resolveMediaProvider("videoGen")?.model.id).toBe("cosmos-x");
  });

  it("flat entries without capabilities infer them from the old assignments", async () => {
    const media = await loadRegistry({
      entries: [{ id: "a", label: "gen", baseUrl: "http://a/v1", api: "openai", model: "m1" }],
      assignments: { imageGen: "a" },
    });
    const m = media.getMediaRegistry().providers[0].models[0];
    expect(m.capabilities).toEqual(["imageGen"]);
    expect(media.resolveMediaProvider("imageGen")?.model.id).toBe("m1");
  });
});

describe("providers + models", () => {
  it("a generate provider keeps exactly one default model with generation-only capabilities", async () => {
    const media = await loadRegistry();
    const pid = media.addProvider();
    media.updateProvider(pid, { baseUrl: "http://b/" });
    media.addModel(pid, "x1");
    media.addModel(pid, "x2");

    media.updateProvider(pid, { api: "generate" });
    const p = media.getMediaRegistry().providers[0];
    expect(p.models).toHaveLength(1);
    expect(p.models[0].modelId).toBe("");
    expect(p.detected).toBeUndefined();
  });

  it("providerCaps constrains what a model can declare", async () => {
    const media = await loadRegistry();
    expect(media.providerCaps("generate")).toEqual(["imageGen"]);
    expect(media.providerCaps("openai")).toHaveLength(6);
  });

  it("a cosmos wire id arrives pre-marked for the JSON enhancer", async () => {
    const media = await loadRegistry();
    const pid = media.addProvider();
    const mid = media.addModel(pid, "nvidia/Cosmos3-T2I");
    const m = media.getMediaRegistry().providers[0].models.find((x) => x.id === mid);
    expect(m?.promptStyle).toBe("cosmos-json");
  });
});

describe("assignment + resolution", () => {
  async function seedProvider(media: Awaited<ReturnType<typeof loadRegistry>>): Promise<{ pid: string; mid: string }> {
    const pid = media.addProvider();
    media.updateProvider(pid, { baseUrl: "http://a/v1", name: "A" });
    const mid = media.addModel(pid, "m1");
    media.updateModel(pid, mid, { capabilities: ["imageGen"] });
    return { pid, mid };
  }

  it("capability tick auto-fills an empty slot, never overrides, and a lost capability prunes", async () => {
    const media = await loadRegistry();
    const { pid, mid } = await seedProvider(media);
    expect(media.getMediaRegistry().assignments.imageGen).toEqual({ providerId: pid, modelId: mid });

    const mid2 = media.addModel(pid, "m2");
    media.updateModel(pid, mid2, { capabilities: ["imageGen"] });
    expect(media.getMediaRegistry().assignments.imageGen?.modelId).toBe(mid); // first pick survives

    media.updateModel(pid, mid, { capabilities: [] });
    expect(media.getMediaRegistry().assignments.imageGen).toBeUndefined();
  });

  it("slotOptions lists 'provider : model' for capable models only", async () => {
    const media = await loadRegistry();
    const { pid, mid } = await seedProvider(media);
    const opts = media.slotOptions("imageGen", media.getMediaRegistry());
    expect(opts).toEqual([{ ref: { providerId: pid, modelId: mid }, label: "A : m1" }]);
    expect(media.slotOptions("videoGen", media.getMediaRegistry())).toEqual([]);
  });

  it("resolution flattens provider + model and goes inert without an endpoint", async () => {
    const media = await loadRegistry();
    const { pid, mid } = await seedProvider(media);
    media.updateModel(pid, mid, { maxImageSize: "1024x1024" });
    const target = media.resolveMediaProvider("imageGen");
    expect(target).toMatchObject({
      provider: { name: "A", type: "openai", baseUrl: "http://a/v1" },
      model: { id: "m1", maxImageSize: "1024x1024" },
    });

    media.updateProvider(pid, { baseUrl: "" });
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
  });

  it("removing a model or provider prunes its assignments", async () => {
    const media = await loadRegistry();
    const { pid, mid } = await seedProvider(media);
    media.removeModel(pid, mid);
    expect(media.getMediaRegistry().assignments.imageGen).toBeUndefined();

    const mid2 = media.addModel(pid, "m2");
    media.updateModel(pid, mid2, { capabilities: ["imageGen"] });
    media.removeProvider(pid);
    expect(media.getMediaRegistry().providers).toHaveLength(0);
    expect(media.resolveMediaProvider("imageGen")).toBeNull();
  });

  it("resolveMediaProviders maps only usable slots", async () => {
    const media = await loadRegistry();
    const { pid, mid } = await seedProvider(media);
    media.updateModel(pid, mid, { capabilities: ["imageGen", "videoGen"] });
    const map = media.resolveMediaProviders();
    expect(Object.keys(map).sort()).toEqual(["imageGen", "videoGen"]);
    expect(map.imageGen?.model.id).toBe("m1");
  });
});
