// Containers — the unified chat / local-workspace / remote-workspace entity (the 3 sidebar
// blocks). Replaces the old Workspace + the magic `workspaceId: null` "Chat" group: a chat is
// just a container of type "chat", linked to no folder/VM. `type` is the WORKSPACE kind (fs / VM),
// independent of where data is stored — storage is the active provider (ctx.storage swaps it).

import { useSyncExternalStore } from "react";

import { newId } from "./ids.ts";
import { createListeners } from "./storage/consumer.ts";
import type { StorageEngine } from "./storage/engine.ts";
import type { Ctx } from "./ctx.ts";
import { rootLog } from "../lib/logger/index.ts";
import { errorMessage } from "../lib/errors.ts";

export type ContainerType = "chat" | "local" | "remote";

export interface Container {
  id: string;
  type: ContainerType;
  name: string;
  permissions: Record<string, unknown>; // JSON policy — the tool ceiling sessions inherit
  config: Record<string, unknown>; // type-specific: {root} for local, {dockerName, root} for remote
  createdAt: number;
  updatedAt: number;
}

export interface ContainerInit {
  type: ContainerType;
  name: string;
  permissions?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

const log = rootLog.child("containers");

let data: StorageEngine | null = null;
let containers: Container[] = [];
let activeId: string | null = null;
let hydrated = false;
const reg = createListeners();

export function setContainerStorage(e: StorageEngine): void {
  data = e;
}

// Read the active provider (local, or remote when connected). Swapping the provider shows the
// other realm's containers — there is no merge or migration.
export async function hydrateContainers(): Promise<void> {
  const e = data;
  hydrated = false;
  try {
    if (!e) return;
    containers = (await e.repos().containers.list()).sort((a, b) => a.createdAt - b.createdAt);
    // Always have at least one container so a session has a home (a default "Chat").
    if (containers.length === 0) {
      const now = Date.now();
      const chat: Container = { id: newId(), type: "chat", name: "Chat", permissions: {}, config: {}, createdAt: now, updatedAt: now };
      await e.repos().containers.put(chat);
      containers = [chat];
    }
    if (!containers.some((c) => c.id === activeId)) activeId = containers[0]?.id ?? null;
  } catch (err) {
    log.warn("hydrate_failed", { error: errorMessage(err) });
  } finally {
    hydrated = true;
    reg.notify();
  }
}

export async function createContainer(init: ContainerInit): Promise<Container | null> {
  const e = data;
  if (!e) return null;
  const now = Date.now();
  const container: Container = {
    id: newId(),
    type: init.type,
    name: init.name,
    permissions: init.permissions ?? {},
    config: init.config ?? {},
    createdAt: now,
    updatedAt: now,
  };
  await e.repos().containers.put(container);
  containers = [...containers, container];
  activeId = container.id;
  reg.notify();
  return container;
}

export async function updateContainer(id: string, patch: Partial<Omit<Container, "id" | "createdAt">>): Promise<void> {
  const e = data;
  const current = containers.find((c) => c.id === id);
  if (!e || !current) return;
  const next: Container = { ...current, ...patch, updatedAt: Date.now() };
  await e.repos().containers.put(next);
  containers = containers.map((c) => (c.id === id ? next : c));
  reg.notify();
}

// Local provider hard-deletes the row; remote provider DELETEs (server soft-deletes). The store
// just drops it from the live list either way.
export async function deleteContainer(id: string): Promise<void> {
  const e = data;
  if (!e || !containers.some((c) => c.id === id)) return;
  await e.repos().containers.remove(id).catch((err: unknown) => log.warn("delete_failed", { id, error: errorMessage(err) }));
  containers = containers.filter((c) => c.id !== id);
  if (activeId === id) activeId = containers[0]?.id ?? null;
  reg.notify();
}

export function setActiveContainer(id: string | null): void {
  activeId = id;
  reg.notify();
}

// ── Selectors ────────────────────────────────────────────────────────────────
export const getContainers = (): Container[] => containers;
export const getContainer = (id: string | null | undefined): Container | undefined =>
  id ? containers.find((c) => c.id === id) : undefined;
export const getActiveContainerId = (): string | null => activeId;
export const getActiveContainer = (): Container | undefined => getContainer(activeId);
export const getContainersByType = (type: ContainerType): Container[] => containers.filter((c) => c.type === type);
export const getContainersHydrated = (): boolean => hydrated;

// ── Hooks ──────────────────────────────────────────────────────────────────
export const useContainers = (): Container[] =>
  useSyncExternalStore(reg.subscribe, () => containers, () => containers);
export const useActiveContainerId = (): string | null =>
  useSyncExternalStore(reg.subscribe, () => activeId, () => activeId);

// Wired at init: inject the host storage. Hydration is orchestrated by init() (containers
// before sessions), so it's not fired here.
export function initContainers(ctx: Ctx): void {
  setContainerStorage(ctx.storage);
}
