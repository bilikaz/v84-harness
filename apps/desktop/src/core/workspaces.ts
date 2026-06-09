import { useSyncExternalStore } from "react";

import { DEFAULT_TOOL_POLICY, type GatedTool, type ToolMode, type ToolName } from "./tools/shared.ts";

// Workspace store — a workspace is a first-class record: a folder (the agent's
// root) + name + per-workspace settings. Sessions LINK to a workspace via
// `session.workspaceId` (the workspace "owns" its sessions as a derived query).
// `activeWorkspaceId` scopes the sidebar's session list; null = the "no
// workspace / chat" group (tool-less sessions). localStorage for now; swaps to
// SQLite via the core/IPC layer later, same surface.
const KEY = "v84-harness:workspaces";

export type { GatedTool, ToolMode, ToolName };

export type Isolation = "worktree" | "direct";

export interface Workspace {
  id: string;
  name: string;
  root: string; // absolute host path (from harness.pickFolder)
  defaultModelId?: string; // which model new sessions here default to
  isolation: Isolation; // worktree-per-session vs. work directly in the folder
  instructions?: string; // optional per-project system prompt
  tools: Record<GatedTool, ToolMode>; // the 0/1/2 permission map (gated tools only)
}

// A new workspace's settings before the user tweaks them.
export function defaultWorkspace(root: string, name: string): Workspace {
  return {
    id: crypto.randomUUID(),
    name,
    root,
    isolation: "worktree",
    tools: { ...DEFAULT_TOOL_POLICY },
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
    tools: { ...DEFAULT_TOOL_POLICY, ...(w.tools ?? {}) },
  };
}

function load(): { workspaces: Workspace[]; activeId: string | null } {
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
  return { workspaces: [], activeId: null };
}

const initial = load();
let workspaces: Workspace[] = initial.workspaces;
let activeId: string | null = initial.activeId;

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ workspaces, activeId }));
  } catch {
    /* ignore */
  }
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ── Selectors ────────────────────────────────────────────────────────────────
export function getWorkspaces(): Workspace[] {
  return workspaces;
}
export function getActiveWorkspaceId(): string | null {
  return activeId;
}
export function getWorkspace(id: string | null | undefined): Workspace | undefined {
  return id ? workspaces.find((w) => w.id === id) : undefined;
}
export function getActiveWorkspace(): Workspace | undefined {
  return getWorkspace(activeId);
}

// ── Commands ─────────────────────────────────────────────────────────────────
// Add a fully-formed workspace (built + edited in the add popup), make it active.
export function addWorkspace(ws: Workspace): void {
  workspaces = [...workspaces, ws];
  activeId = ws.id;
  persist();
  emit();
}

export function updateWorkspace(id: string, patch: Partial<Omit<Workspace, "id">>): void {
  workspaces = workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
  persist();
  emit();
}

export function deleteWorkspace(id: string): void {
  workspaces = workspaces.filter((w) => w.id !== id);
  if (activeId === id) activeId = null;
  persist();
  emit();
}

// null selects the "no workspace / chat" group.
export function setActiveWorkspace(id: string | null): void {
  activeId = id;
  persist();
  emit();
}

// ── Hooks ────────────────────────────────────────────────────────────────────
export function useWorkspaces(): Workspace[] {
  return useSyncExternalStore(subscribe, getWorkspaces, getWorkspaces);
}
export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(subscribe, getActiveWorkspaceId, getActiveWorkspaceId);
}
export function useActiveWorkspace(): Workspace | undefined {
  return useSyncExternalStore(subscribe, getActiveWorkspace, getActiveWorkspace);
}
