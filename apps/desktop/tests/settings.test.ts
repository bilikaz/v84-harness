// Unified Settings registry (ADR-0042) — providers → models → per-service
// assignments, with `main` alongside the media services. Capability ticks auto-fill
// an empty slot, stale assignments prune, and an unassigned/endpoint-less slot
// resolves null (tool inert), never "whatever exists". The legacy media-store
// migration tests are gone — the unified store has no legacy format to migrate
// (ADR-0042 carries one shape end to end, no migrations).
import { beforeEach, describe, expect, it } from "vitest";

import {
  addModel,
  addProvider,
  getMediaRegistry,
  providerCaps,
  removeModel,
  removeProvider,
  resolveMediaProvider,
  slotOptions,
  updateModel,
  updateProvider,
} from "../src/core/settings.ts";
import { hydrateConsumers } from "../src/core/storage/consumer.ts";
import { initTestCtx } from "./ctx.ts";

// A media provider with one imageGen-capable model "m1" (the default `main`
// provider from DEFAULTS stays present and untouched — media slots ignore it).
function seedProvider(): { pid: string; mid: string } {
  const pid = addProvider();
  updateProvider(pid, { baseUrl: "http://a/v1", name: "A" });
  const mid = addModel(pid, "m1");
  updateModel(pid, mid, { capabilities: ["imageGen"] });
  return { pid, mid };
}

const providerById = (id: string) => getMediaRegistry().providers.find((p) => p.id === id);

beforeEach(() => initTestCtx());

describe("providers + models", () => {
  it("a generate provider keeps exactly one default model with generation-only capabilities", () => {
    const pid = addProvider();
    updateProvider(pid, { baseUrl: "http://b/" });
    addModel(pid, "x1");
    addModel(pid, "x2");

    updateProvider(pid, { api: "generate" });
    const p = providerById(pid)!;
    expect(p.models).toHaveLength(1);
    expect(p.models[0].modelId).toBe("");
    expect(p.detected).toBeUndefined();
  });

  it("providerCaps constrains what a model can declare", () => {
    expect(providerCaps("generate")).toEqual(["imageGen"]);
    expect(providerCaps("openai")).toHaveLength(7); // 6 media + subAgent
  });

  it("a cosmos wire id arrives pre-marked for the JSON enhancer", () => {
    const pid = addProvider();
    const mid = addModel(pid, "nvidia/Cosmos3-T2I");
    expect(providerById(pid)!.models.find((x) => x.id === mid)?.promptStyle).toBe("cosmos-json");
  });
});

describe("assignment + resolution", () => {
  it("capability tick appends to the pool (ordered), and a lost capability prunes that entry", () => {
    const { pid, mid } = seedProvider();
    expect(getMediaRegistry().assignments.imageGen).toEqual([{ providerId: pid, modelId: mid }]);

    const mid2 = addModel(pid, "m2");
    updateModel(pid, mid2, { capabilities: ["imageGen"] });
    const pool = getMediaRegistry().assignments.imageGen!;
    expect(pool).toHaveLength(2);
    expect(pool[0].modelId).toBe(mid); // first pick keeps its priority position

    updateModel(pid, mid, { capabilities: [] });
    expect(getMediaRegistry().assignments.imageGen).toEqual([{ providerId: pid, modelId: mid2 }]);
  });

  it("slotOptions lists 'provider : model' for capable models only", () => {
    const { pid, mid } = seedProvider();
    expect(slotOptions("imageGen", getMediaRegistry())).toEqual([{ ref: { providerId: pid, modelId: mid }, label: "A : m1" }]);
    expect(slotOptions("videoGen", getMediaRegistry())).toEqual([]);
  });

  it("resolution flattens provider + model and goes inert without an endpoint", () => {
    const { pid, mid } = seedProvider();
    updateModel(pid, mid, { maxImageSize: "1024x1024" });
    expect(resolveMediaProvider("imageGen")).toMatchObject({
      provider: { name: "A", type: "openai", baseUrl: "http://a/v1" },
      model: { id: "m1", maxImageSize: "1024x1024" },
    });

    updateProvider(pid, { baseUrl: "" });
    expect(resolveMediaProvider("imageGen")).toBeNull();
  });

  it("a structurally-malformed stored row hydrates to DEFAULTS instead of throwing", async () => {
    const ctx = initTestCtx();
    // Legacy/corrupt: services.main is a single object, not the ordered array resolvePools maps over.
    await ctx.storage.repos().settings.put({
      key: "v84-harness:settings",
      scope: "account",
      value: JSON.stringify({ providers: [], services: { main: { providerId: "x", modelId: "y" } } }),
    });
    await expect(hydrateConsumers()).resolves.toBeDefined();
    expect(getMediaRegistry().providers.some((p) => p.id === "default-provider")).toBe(true);
    expect(getMediaRegistry().assignments.main).toEqual([{ providerId: "default-provider", modelId: "default-main" }]);
  });

  it("removing a model or provider prunes its assignments", () => {
    const { pid, mid } = seedProvider();
    removeModel(pid, mid);
    expect(getMediaRegistry().assignments.imageGen).toBeUndefined();

    const mid2 = addModel(pid, "m2");
    updateModel(pid, mid2, { capabilities: ["imageGen"] });
    removeProvider(pid);
    expect(providerById(pid)).toBeUndefined();
    expect(resolveMediaProvider("imageGen")).toBeNull();
  });
});
