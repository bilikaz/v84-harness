// Sub-agent catalog + name resolution — what an orchestrator is allowed to see and run.
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, getAgents, saveAgent } from "../src/core/agents.ts";
import {
  GENERAL_AGENT_ID,
  agentToolSchemas,
  aliasOf,
  catalogAgents,
  childrenOf,
  isChildPending,
  listAgentsOutput,
  resolveAgent,
  resolveChild,
  rosterHint,
} from "../src/core/tools/helpers/agents/catalog.ts";
import { createSession, getUserPausedIds, setStreaming, setUserPaused } from "../src/core/sessions/store.ts";
import { initTestCtx } from "./ctx.ts";

// The agents store is a ctx-injected consumer (ADR-0037) — build a fresh one and
// empty it before each case (clears any default seed too).
function resetLibrary(): void {
  initTestCtx();
  for (const a of getAgents()) deleteAgent(a.id);
}

function addAgent(name: string, patch: { workspace?: boolean; description?: string } = {}): string {
  const id = createAgent(name);
  saveAgent(id, { description: "does things", ...patch });
  return id;
}

beforeEach(resetLibrary);

describe("catalogAgents", () => {
  it("hides workspace agents from a chat context, shows them in a workspace (after the built-in General agent)", () => {
    addAgent("chat worker");
    addAgent("repo worker", { workspace: true });
    expect(catalogAgents(false).map((a) => a.name)).toEqual(["General agent", "chat worker"]);
    expect(catalogAgents(true).map((a) => a.name)).toEqual(["General agent", "chat worker", "repo worker"]);
  });

  it("excludes unnamed agents — the name is the address", () => {
    addAgent("  "); // whitespace-only
    addAgent("named");
    expect(catalogAgents(true).map((a) => a.name)).toEqual(["General agent", "named"]);
  });
});

describe("built-in General agent", () => {
  it("is always available and resolvable, in both chat and workspace", () => {
    expect(catalogAgents(false).some((a) => a.id === GENERAL_AGENT_ID)).toBe(true);
    expect(catalogAgents(true).some((a) => a.id === GENERAL_AGENT_ID)).toBe(true);
    const hit = resolveAgent("General agent", false);
    expect((hit as { id: string }).id).toBe(GENERAL_AGENT_ID);
  });

  it("inherits the caller's context — empty system, no tool ceiling", () => {
    const g = catalogAgents(true).find((a) => a.id === GENERAL_AGENT_ID)!;
    expect(g.system).toBe("");
    expect(g.tools).toEqual({});
  });

  it("steps aside when the user defines their own General agent (theirs wins, no clash)", () => {
    addAgent("General agent");
    expect(catalogAgents(true).filter((a) => a.id === GENERAL_AGENT_ID)).toHaveLength(0);
    expect(catalogAgents(true).filter((a) => a.name === "General agent")).toHaveLength(1);
  });
});

describe("agentToolSchemas", () => {
  it("always advertises the pair — the built-in General agent keeps the catalog non-empty", () => {
    expect(agentToolSchemas(true).map((s) => s.function.name)).toEqual(["ListAgents", "RunAgent"]);
    expect(agentToolSchemas(false).map((s) => s.function.name)).toEqual(["ListAgents", "RunAgent"]);
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

// Team addressing: a parent's children carry a short handle (#1, #2, …) baked into their title at spawn, so
// the orchestrator addresses them by number — never a ULID — across AskAgent/ResumeAgent/ActiveAgents. The
// handle rides in the title (which persists + shows in the sidebar), and aliasOf parses it back out.
describe("child aliases (team addressing)", () => {
  // Unique parent id per call → the module-level sessions store can accumulate across tests harmlessly.
  function parentWithKids(n: number): { parent: string; kids: string[] } {
    const parent = createSession({ title: "Parent" });
    const kids = Array.from({ length: n }, (_, i) => createSession({ title: `Kid ${i + 1}`, parentId: parent }));
    return { parent, kids };
  }

  it("bakes #1..#N into the title in spawn order and round-trips id ↔ handle", () => {
    const { parent } = parentWithKids(3);
    const ordered = childrenOf(parent);
    expect(ordered.map((s) => s.title)).toEqual(["Kid 1 #1", "Kid 2 #2", "Kid 3 #3"]); // handle order = spawn order
    ordered.forEach((s, i) => expect(aliasOf(s)).toBe(i + 1));
  });

  it("resolves an id back to the child, leniently (number, string, quoted)", () => {
    const { parent } = parentWithKids(3);
    expect(resolveChild(parent, 2)?.title).toBe("Kid 2 #2");
    expect(resolveChild(parent, "2")?.title).toBe("Kid 2 #2");
    expect(resolveChild(parent, ' "2" ')?.title).toBe("Kid 2 #2");
  });

  it("returns undefined for out-of-range or non-numeric ids", () => {
    const { parent } = parentWithKids(2);
    expect(resolveChild(parent, 0)).toBeUndefined();
    expect(resolveChild(parent, 9)).toBeUndefined();
    expect(resolveChild(parent, "nope")).toBeUndefined();
  });

  it("scopes ids to the asking parent — never another parent's children", () => {
    const a = parentWithKids(2);
    const b = parentWithKids(1);
    expect(childrenOf(a.parent).some((s) => s.id === b.kids[0])).toBe(false);
    // id 1 under A resolves to A's first child, not B's.
    expect(resolveChild(a.parent, 1)?.id).not.toBe(b.kids[0]);
  });

  it("rosterHint lists the team by id with status, or says there are none", () => {
    const { parent } = parentWithKids(2);
    const hint = rosterHint(parent);
    expect(hint).toContain(`Kid 1 #1 — idle`);
    expect(hint).toContain(`Kid 2 #2 — idle`);
    expect(rosterHint(createSession({ title: "Lonely" }))).toMatch(/no sub-agents running/);
  });
});

// Async orchestration state model: a child is "pending" (not readable) while running OR user-paused; only
// a terminal child carries a readable result. (getAgentContent erases on pending; delivery skips paused.)
describe("child pending state (async orchestration)", () => {
  beforeEach(resetLibrary);

  it("is pending while streaming, and while user-paused, else not", () => {
    const parent = createSession({ title: "Parent" });
    const kid = createSession({ title: "Kid", parentId: parent });
    const child = () => childrenOf(parent)[0];

    expect(isChildPending(child())).toBe(false); // freshly spawned, idle terminal

    setStreaming(kid, true);
    expect(isChildPending(child())).toBe(true); // running
    setStreaming(kid, false);
    expect(isChildPending(child())).toBe(false);

    setUserPaused(kid, true);
    expect(isChildPending(child())).toBe(true); // user-paused (a pause, not done)
    setUserPaused(kid, false);
    expect(isChildPending(child())).toBe(false);
  });

  it("a turn start (streaming on) clears a user pause — the child is running again", () => {
    const kid = createSession({ title: "Kid", parentId: createSession({ title: "Parent" }) });
    setUserPaused(kid, true);
    expect(getUserPausedIds().has(kid)).toBe(true);
    setStreaming(kid, true); // resume / new message
    expect(getUserPausedIds().has(kid)).toBe(false);
  });
});
