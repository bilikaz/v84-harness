import { createStore } from "../lib/store.ts";
import { type GatedTool, type ToolPermission, type ToolName } from "./tools/types.ts";

// Workspace store — a folder (the agent's root) + name + per-workspace settings.
const KEY = "v84-harness:workspaces";

export type { GatedTool, ToolPermission, ToolName };

export type Isolation = "worktree" | "direct";

export interface Workspace {
  id: string;
  name: string;
  root: string; // absolute host path
  defaultModelId?: string;
  isolation: Isolation;
  instructions?: string;
  tools: Record<GatedTool, ToolPermission>; // gated tools the user has set a mode for; the rest fall back to each tool's defaultPermission()
}

interface WsState {
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

function load(): WsState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { workspaces?: Partial<Workspace>[]; activeId?: string | null };
      const workspaces = (parsed.workspaces ?? []).filter(Boolean).map(normalize);
      const activeId = workspaces.some((w) => w.id === parsed.activeId) ? parsed.activeId! : null;
      return { workspaces, activeId };
    }
  } catch {
    /* fall through */
  }
  return null;
}

const store = createStore<WsState>(KEY, { workspaces: [], activeId: null }, load);

// ── Selectors ────────────────────────────────────────────────────────────────
export function getWorkspaces(): Workspace[] {
  return store.get().workspaces;
}
export function getActiveWorkspaceId(): string | null {
  return store.get().activeId;
}
export function getWorkspace(id: string | null | undefined): Workspace | undefined {
  return id ? store.get().workspaces.find((w) => w.id === id) : undefined;
}
export function getActiveWorkspace(): Workspace | undefined {
  return getWorkspace(store.get().activeId);
}

// ── Commands ─────────────────────────────────────────────────────────────────
export function addWorkspace(ws: Workspace): void {
  store.set({ workspaces: [...store.get().workspaces, ws], activeId: ws.id });
}

export function updateWorkspace(id: string, patch: Partial<Omit<Workspace, "id">>): void {
  store.patch({ workspaces: store.get().workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
}

export function deleteWorkspace(id: string): void {
  const { workspaces, activeId } = store.get();
  store.set({ workspaces: workspaces.filter((w) => w.id !== id), activeId: activeId === id ? null : activeId });
}

// null selects the "no workspace / chat" group.
export function setActiveWorkspace(id: string | null): void {
  store.patch({ activeId: id });
}

// ── Hooks ────────────────────────────────────────────────────────────────────
export function useWorkspaces(): Workspace[] {
  return store.useSelect((s) => s.workspaces);
}
export function useActiveWorkspaceId(): string | null {
  return store.useSelect((s) => s.activeId);
}
export function useActiveWorkspace(): Workspace | undefined {
  return store.useSelect((s) => (s.activeId ? s.workspaces.find((w) => w.id === s.activeId) : undefined));
}
