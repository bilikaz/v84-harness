// The base every plugin graph extends — mirrors BaseTool. A graph is code, globbed from
// plugins/<slug>/graphs/<file>.ts and registered by getId(). It declares an entry node + a registry of named
// nodes, each a start/end pair (see types.ts). The engine drives them event-by-event; the graph holds no loop.

import type { GraphNode } from "./types.ts";

export abstract class BaseGraph {
  // Identity, wired by the registry from the glob path (plugin slug + file name).
  pluginSlug = "";
  fileName = "";

  getId(): string {
    return `${this.pluginSlug}:${this.fileName}`;
  }
  getTitle(): string {
    return this.getId();
  }
  // Whether this graph needs a workspace (file access). Launcher hidden outside one. Default false.
  needsWorkspace(): boolean {
    return false;
  }

  // The node to run first, and the named-node registry. Each node is a start/end pair.
  abstract readonly entry: string;
  abstract readonly nodes: Record<string, GraphNode>;
}
