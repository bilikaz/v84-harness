import { Consumer } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";
import { type ToolName, type ToolPermission } from "./tools/types.ts";

// Workspace consumer — a folder (the agent's root) + name + per-workspace settings.
// Persisted through ctx.storage like every other consumer.
const KEY = "v84-harness:workspaces";

export type { ToolName, ToolPermission };

export type Isolation = "worktree" | "direct";

export interface Workspace {
  id: string;
  name: string;
  root: string; // absolute host path
  defaultModelId?: string;
  isolation: Isolation;
  instructions?: string;
  tools: Record<ToolName, ToolPermission>; // gated tools the user has set a mode for; the rest fall back to each tool's defaultPermission()
}

interface WorkspacesState {
  workspaces: Workspace[];
  activeId: string | null;
}

export function defaultWorkspace(root: string, name: string): Workspace {
  return {
    id: crypto.randomUUID(),
    name,
    root,
    isolation: "worktree",
    tools: {},
  };
}

function normalize(w: Partial<Workspace>): Workspace {
  return {
    id: w.id ?? crypto.randomUUID(),
    name: w.name ?? "",
    root: w.root ?? "",
    defaultModelId: w.defaultModelId,
    isolation: w.isolation === "direct" ? "direct" : "worktree",
    instructions: w.instructions,
    tools: { ...(w.tools ?? {}) },
  };
}

class Workspaces extends Consumer<WorkspacesState> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, { workspaces: [], activeId: null });
  }

  protected override parse(raw: string): WorkspacesState {
    const parsed = JSON.parse(raw) as { workspaces?: Partial<Workspace>[]; activeId?: string | null };
    const workspaces = (parsed.workspaces ?? []).filter(Boolean).map(normalize);
    const activeId = workspaces.some((w) => w.id === parsed.activeId) ? parsed.activeId! : null;
    return { workspaces, activeId };
  }

  list(): Workspace[] {
    return this.state.workspaces;
  }
  activeId(): string | null {
    return this.state.activeId;
  }
  find(id: string | null | undefined): Workspace | undefined {
    return id ? this.state.workspaces.find((w) => w.id === id) : undefined;
  }
  active(): Workspace | undefined {
    return this.find(this.state.activeId);
  }
  add(ws: Workspace): void {
    this.commit({ workspaces: [...this.state.workspaces, ws], activeId: ws.id });
  }
  update(id: string, patch: Partial<Omit<Workspace, "id">>): void {
    this.commit({ ...this.state, workspaces: this.state.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  }
  remove(id: string): void {
    this.commit({
      workspaces: this.state.workspaces.filter((w) => w.id !== id),
      activeId: this.state.activeId === id ? null : this.state.activeId,
    });
  }
  setActive(id: string | null): void {
    this.commit({ ...this.state, activeId: id });
  }

  useList = (): Workspace[] => this.useSelect((s) => s.workspaces);
  useActiveId = (): string | null => this.useSelect((s) => s.activeId);
  useActive = (): Workspace | undefined =>
    this.useSelect((s) => (s.activeId ? s.workspaces.find((w) => w.id === s.activeId) : undefined));
}

let inst: Workspaces;
export function initWorkspaces(ctx: Ctx): Workspaces {
  inst = new Workspaces(ctx);
  return inst;
}

// Module facades — the public API; thin delegates to the ctx-injected singleton.
export const getWorkspaces = (): Workspace[] => inst.list();
export const getActiveWorkspaceId = (): string | null => inst.activeId();
export const getWorkspace = (id: string | null | undefined): Workspace | undefined => inst.find(id);
export const getActiveWorkspace = (): Workspace | undefined => inst.active();
export const addWorkspace = (ws: Workspace): void => inst.add(ws);
export const updateWorkspace = (id: string, patch: Partial<Omit<Workspace, "id">>): void => inst.update(id, patch);
export const deleteWorkspace = (id: string): void => inst.remove(id);
export const setActiveWorkspace = (id: string | null): void => inst.setActive(id);
export const useWorkspaces = (): Workspace[] => inst.useList();
export const useActiveWorkspaceId = (): string | null => inst.useActiveId();
export const useActiveWorkspace = (): Workspace | undefined => inst.useActive();
