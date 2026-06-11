// Placement vs capability: a session's workspaceId says where it LIVES (the
// sidebar group), the linked agent says what it MAY TOUCH. A chat-only agent
// placed in a workspace must get zero gated tools (the mask), a workspace
// agent gets min(workspace policy, ceiling), and dropping the link — agent
// deleted or explicitly unlinked — degrades to the plain workspace policy.
import { beforeEach, describe, expect, it } from "vitest";

import { createAgent, deleteAgent, getAgents, saveAgent } from "../src/core/agents.ts";
import { addWorkspace, defaultWorkspace, deleteWorkspace, getWorkspaces } from "../src/core/workspaces.ts";
import { sessionToolModes } from "../src/core/sessions/driver.ts";
import { createSession, getSession, unlinkAgent } from "../src/core/sessions/store.ts";
import { ALL_TOOLS } from "../src/core/tools/types.ts";

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
  it("masks the workspace for a chat-only agent — placement is never a grant", () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    const modes = sessionToolModes(getSession(sid)!);
    for (const tool of ALL_TOOLS) expect(modes[tool]).toBe(0);
  });

  it("applies min(workspace policy, ceiling) for a workspace agent", () => {
    const ws = defaultWorkspace("/tmp/x", "x"); // default policy: Read 2, Bash 1
    addWorkspace(ws);
    const agentId = addAgent("reviewer", { workspace: true, tools: { Write: 0, Bash: 2 } });
    const sid = createSession({ workspaceId: ws.id, agentId });
    const modes = sessionToolModes(getSession(sid)!);
    expect(modes.Read).toBe(2); // workspace grant, ceiling auto
    expect(modes.Write).toBe(0); // ceiling restricts
    expect(modes.Bash).toBe(1); // ceiling can't extend the workspace's "ask"
  });

  it("degrades to the plain workspace policy when the agent is deleted", () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    deleteAgent(agentId);
    expect(sessionToolModes(getSession(sid)!).Read).toBe(2);
  });

  it("unlinkAgent clears the link, converting the session to plain workspace permissions", () => {
    const ws = defaultWorkspace("/tmp/x", "x");
    addWorkspace(ws);
    const agentId = addAgent("joker", { workspace: false });
    const sid = createSession({ workspaceId: ws.id, agentId });
    unlinkAgent(sid);
    expect(getSession(sid)!.agentId).toBeUndefined();
    expect(sessionToolModes(getSession(sid)!).Read).toBe(2);
  });
});
