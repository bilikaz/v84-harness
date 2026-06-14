// Renderer cache of the gated-tool descriptors. The renderer can't import workspace tools (bundle),
// so the permission metadata arrives once over IPC and is cached here for the policy math (driver) and
// the settings UIs. The web build has no main process → empty (no gated tools exist there).

import { ctx } from "../init.ts";
import { createStore } from "../../lib/store.ts";
import type { ToolDescriptor, ToolPermission } from "./types.ts";

const store = createStore<ToolDescriptor[]>(null, []);

export function useToolDescriptors(): ToolDescriptor[] {
  return store.use();
}

export function permissionedTools(): ToolDescriptor[] {
  return store.get().filter((d) => d.permissioned);
}

// Whether a tool is gated + its default mode — from the cached descriptors (permissionless if unknown).
export function toolPermission(name: string): { permissioned: boolean; defaultMode: ToolPermission } {
  const d = store.get().find((x) => x.name === name);
  return d ? { permissioned: d.permissioned, defaultMode: d.defaultMode } : { permissioned: false, defaultMode: 2 };
}

let loaded = false;
// Fetch the descriptors through the platform's gateway once. Awaited before the first turn so the policy math
// never sees an empty cache (which would read a gated tool as permissionless).
export async function loadToolDescriptors(): Promise<void> {
  if (loaded) return;
  store.set(await ctx.tools.descriptors());
  loaded = true;
}

// Seed the cache directly — for tests and other non-IPC contexts.
export function setToolDescriptors(descriptors: ToolDescriptor[]): void {
  store.set(descriptors);
  loaded = true;
}
