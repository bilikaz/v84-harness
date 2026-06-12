// Sub-agent catalog + name resolution — what an orchestrator is allowed to see and run.
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, getAgents, saveAgent } from "../src/core/agents.ts";
import { agentToolSchemas, catalogAgents, listAgentsOutput, resolveAgent } from "../src/core/sessions/agentTools.ts";

// The agents store is a module singleton seeded on first import — reset before each case.
function resetLibrary(): void {
  for (const a of getAgents()) deleteAgent(a.id);
}

function addAgent(name: string, patch: { workspace?: boolean; description?: string } = {}): string {
  const id = createAgent(name);
  saveAgent(id, { description: "does things", ...patch });
  return id;
}

beforeEach(resetLibrary);

describe("catalogAgents", () => {
  it("hides workspace agents from a chat context, shows them in a workspace", () => {
    addAgent("chat worker");
    addAgent("repo worker", { workspace: true });
    expect(catalogAgents(false).map((a) => a.name)).toEqual(["chat worker"]);
    expect(catalogAgents(true).map((a) => a.name)).toEqual(["chat worker", "repo worker"]);
  });

  it("excludes unnamed agents — the name is the address", () => {
    addAgent("  "); // whitespace-only
    addAgent("named");
    expect(catalogAgents(true).map((a) => a.name)).toEqual(["named"]);
  });
});

describe("agentToolSchemas", () => {
  it("advertises nothing when the runnable catalog is empty", () => {
    expect(agentToolSchemas(true)).toEqual([]);
    addAgent("repo worker", { workspace: true });
    expect(agentToolSchemas(false)).toEqual([]); // chat context can't run it
  });

  it("advertises the stable pair when the catalog is non-empty", () => {
    addAgent("worker");
    const names = agentToolSchemas(false).map((s) => s.function.name);
    expect(names).toEqual(["ListAgents", "RunAgent"]);
  });
});

describe("listAgentsOutput", () => {
  it("lists quoted names with descriptions — no markers glued to the name", () => {
    addAgent("summarizer", { description: "summarizes text" });
    addAgent("repo worker", { workspace: true });
    const out = listAgentsOutput(true);
    expect(out).toContain('- "summarizer" — summarizes text');
    expect(out).toContain('- "repo worker" — does things');
    expect(out).not.toContain("[workspace"); // the marker confused models into treating it as part of the name
  });
});

describe("resolveAgent", () => {
  it("matches case-insensitively with surrounding whitespace", () => {
    const id = addAgent("Summarizer");
    const hit = resolveAgent("  summarizer ", false);
    expect(typeof hit).not.toBe("string");
    expect((hit as { id: string }).id).toBe(id);
  });

  it("forgives catalog decoration echoed into the name — quotes and bracketed markers", () => {
    const id = addAgent("Code reviewer", { workspace: true });
    for (const sent of ['"Code reviewer"', "Code reviewer [workspace]", '"Code reviewer" [workspace agent]']) {
      const hit = resolveAgent(sent, true);
      expect(typeof hit, `for input ${sent}`).not.toBe("string");
      expect((hit as { id: string }).id).toBe(id);
    }
  });

  it("returns the valid names on a miss — a blind guess costs one step, like listing", () => {
    addAgent("summarizer");
    const out = resolveAgent("sumarizer", false);
    expect(out).toMatch(/no agent is named "sumarizer"/);
    expect(out).toContain('- "summarizer"');
  });

  it("refuses ambiguous names instead of picking one", () => {
    addAgent("twin");
    addAgent("twin");
    expect(resolveAgent("twin", false)).toMatch(/ambiguous/);
  });

  it("never resolves a workspace agent for a chat context", () => {
    addAgent("repo worker", { workspace: true });
    addAgent("chat worker");
    expect(resolveAgent("repo worker", false)).toMatch(/no agent is named/);
  });
});
