// Placement vs capability — workspaceId says where a session LIVES, the linked agent what it MAY TOUCH; a dropped link degrades to the plain workspace policy.
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, getAgents, saveAgent } from "../src/core/agents.ts";
import { addWorkspace, defaultWorkspace, deleteWorkspace, getWorkspaces } from "../src/core/workspaces.ts";
import { createSession, getSession, unlinkAgent } from "../src/core/sessions/store.ts";
import { SessionEngine } from "../src/core/sessions/engine.ts";
import { toolFilter } from "../src/electron/tools.ts";
import { getConfig } from "../src/core/config/index.ts";
import type { Ctx } from "../src/core/ctx.ts";

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
  for (const a of getAgents()) deleteAgent(a.id);
  for (const w of getWorkspaces()) deleteWorkspace(w.id);
}

function addAgent(name: string, patch: Parameters<typeof saveAgent>[1]): string {
  const id = createAgent(name);
  saveAgent(id, patch);
  return id;
}

beforeEach(reset);

describe("sessionToolModes", () => {
  it("masks the workspace for a chat-only agent — placement is never a grant", async () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    const modes = await modesFor(sid);
    const vals = Object.values(modes);
    expect(vals.length).toBeGreaterThan(0);
    for (const m of vals) expect(m).toBe(0);
  });

  it("applies min(workspace policy, ceiling) for a workspace agent", async () => {
    const ws = defaultWorkspace("/tmp/x", "x"); // empty policy → per-tool defaults: Read 2, Bash 1
    addWorkspace(ws);
    const agentId = addAgent("reviewer", { workspace: true, tools: { Write: 0, Bash: 2 } });
    const sid = createSession({ workspaceId: ws.id, agentId });
    const modes = await modesFor(sid);
    expect(modes.Read).toBe(2); // workspace grant, ceiling auto
    expect(modes.Write).toBe(0); // ceiling restricts
    expect(modes.Bash).toBe(1); // ceiling can't extend the workspace's "ask"
  });

  it("degrades to the plain workspace policy when the agent is deleted", async () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    deleteAgent(agentId);
    expect((await modesFor(sid)).Read).toBe(2);
  });

  it("unlinkAgent clears the link, converting the session to plain workspace permissions", async () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    unlinkAgent(sid);
    expect(getSession(sid)!.agentId).toBeUndefined();
    expect((await modesFor(sid)).Read).toBe(2);
  });
});
