// The central graph registry — graphs are code (not stored data), registered here at boot from the plugin
// glob and resolved by id. Mirrors the tool registry: one place owns the set, runtime gating filters it.
// (Slice 1 has no enabled-gating yet — that joins when the plugin glob lands.)

import type { BaseGraph } from "./base.ts";

const registry = new Map<string, BaseGraph>();

export function registerGraph(graph: BaseGraph): void {
  registry.set(graph.getId(), graph);
}

export function getGraph(id: string): BaseGraph | undefined {
  return registry.get(id);
}

export function listGraphs(): BaseGraph[] {
  return [...registry.values()];
}

// Test/HMR seam — drop all registrations so a re-register doesn't accumulate stale duplicates.
export function clearGraphs(): void {
  registry.clear();
}
