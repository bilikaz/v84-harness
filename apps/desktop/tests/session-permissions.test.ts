// Placement vs capability — workspaceId says where a session LIVES, the linked agent what it MAY TOUCH; a dropped link degrades to the plain workspace policy.
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, getAgents, saveAgent } from "../src/core/agents.ts";
import { createContainer } from "../src/core/containers.ts";
import { createSession, getSession, unlinkAgent } from "../src/core/sessions/store.ts";
import { SessionEngine } from "../src/core/sessions/engine.ts";
import { toolFilter } from "../src/electron/tools.ts";
import { getConfig } from "../src/core/config/index.ts";
import type { Ctx } from "../src/core/ctx.ts";
import { initTestCtx } from "./ctx.ts";

// sessionToolModes is an engine method now: it resolves the policy through ctx.tools.filter. Drive the real
// engine with a gateway backed by the real (electron) tool registry — only .filter is exercised here.
const gateway = {
  filter: (params?: Parameters<typeof toolFilter>[1]) => toolFilter({ config: getConfig() }, params),
  run: async () => null,
  cancel: () => {},
};
const engine = new SessionEngine({ tools: gateway } as unknown as Ctx);
const modesFor = (sid: string) => engine.sessionToolModes(getSession(sid)!);

function reset(): void {
  initTestCtx(); // agents + containers are ctx-injected now
  for (const a of getAgents()) deleteAgent(a.id);
}

function addAgent(name: string, patch: Parameters<typeof saveAgent>[1]): string {
  const id = createAgent(name);
  saveAgent(id, patch);
  return id;
}

// A local-workspace container (empty policy → per-tool defaults: Read 2, Bash 1).
async function localContainer(): Promise<string> {
  const c = await createContainer({ type: "local", name: "x", placement: "local", config: { root: "/tmp/x" } });
  return c!.id;
}

beforeEach(reset);

describe("sessionToolModes", () => {
  it("masks the workspace for a chat-only agent — placement is never a grant", async () => {
    const cid = await localContainer();
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ containerId: cid, agentId });
    const modes = await modesFor(sid);
    const entries = Object.entries(modes);
    expect(entries.length).toBeGreaterThan(0);
    // Workspace (fs) tools are masked to 0 — placement grants nothing. A permissioned tool that needs NO
    // workspace (Fetch — arbitrary HTTP) is workspace-independent, so it stays available even in chat.
    for (const [name, m] of entries) {
      if (name === "Fetch") expect(m).toBe(1); // ask, available
      else expect(m).toBe(0);
    }
  });

  it("applies min(workspace policy, ceiling) for a workspace agent", async () => {
    const cid = await localContainer(); // empty policy → per-tool defaults: Read 2, Bash 1
    const agentId = addAgent("reviewer", { workspace: true, tools: { Write: 0, Bash: 2 } });
    const sid = createSession({ containerId: cid, agentId });
    const modes = await modesFor(sid);
    expect(modes.Read).toBe(2); // workspace grant, ceiling auto
    expect(modes.Write).toBe(0); // ceiling restricts
    expect(modes.Bash).toBe(1); // ceiling can't extend the workspace's "ask"
  });

  it("degrades to the plain workspace policy when the agent is deleted", async () => {
    const cid = await localContainer();
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ containerId: cid, agentId });
    deleteAgent(agentId);
    expect((await modesFor(sid)).Read).toBe(2);
  });

  it("unlinkAgent clears the link, converting the session to plain workspace permissions", async () => {
    const cid = await localContainer();
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ containerId: cid, agentId });
    unlinkAgent(sid);
    expect(getSession(sid)!.agentId).toBeUndefined();
    expect((await modesFor(sid)).Read).toBe(2);
  });
});
