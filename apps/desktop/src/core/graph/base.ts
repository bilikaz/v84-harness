// The base every plugin graph extends — mirrors BaseTool. A graph is code, globbed from
// plugins/<slug>/graphs/<file>.ts and registered by getId(). It declares an entry node + a registry of named
// nodes, each a start/end pair (see types.ts). The engine drives them event-by-event; the graph holds no loop.

import type { GraphNode } from "./types.ts";

// The reserved terminal node, owned here (always the same), reached by routing to it (`{ goTo: EXIT }`).
// Symmetric to `entry`: the engine treats reaching it as the end of the run. It renders whatever it is
// routed as a fenced ```json block — the run's final chat output (machinery payload, easy to read/copy).
export const EXIT = "exit";

// A user-rejected response: a node throws this (via ctx.break) to PARK the run instead of advancing. The
// engine catches it, posts the message, and waits for `continue` (which re-runs the parked node). Not an error.
export class GraphBreak extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "GraphBreak";
  }
}

// Render the exit payload. A JSON string is pretty-printed inside a fenced block; a non-JSON string passes
// through verbatim; anything else is stringified. Heads already return JSON, so the final output stays
// consistent and copy-pasteable.
export function toJsonBlock(input: unknown): string {
  let value = input;
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return "";
    try {
      value = JSON.parse(t);
    } catch {
      return input; // not JSON — emit as-is
    }
  }
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

// The built-in exit node. Its end() is never called (the engine settles when the exit node's start completes).
export const EXIT_NODE: GraphNode = {
  start: (_ctx, input) => ({ value: toJsonBlock(input) }),
  end: () => ({ goTo: EXIT }),
};

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

  // The node to run first, and the named-node registry. Each node is a start/end pair. The terminal `exit`
  // node is provided by the engine (EXIT_NODE) — routes reach it by name, it is not declared here.
  abstract readonly entry: string;
  abstract readonly nodes: Record<string, GraphNode>;
}
