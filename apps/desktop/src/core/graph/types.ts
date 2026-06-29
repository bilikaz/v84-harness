// Graph domain vocabulary — an event-driven, named-node model (see implementation.md). A graph is a registry
// of named nodes, each a start/end pair: start(input) kicks off the work (a Select, a child head, or a sync
// value); when that work finishes the engine calls end(result), which routes onward. The graph advances only
// on child/work completion — there is no polling loop. Joins are producer-declared and arrival-driven.

export type JsonSchema = Record<string, unknown>;

export interface SelectOption {
  id: string;
  label: string;
  // For `view: "tree"` — nested options. Selecting a parent cascades to all descendants.
  children?: SelectOption[];
}
// A selection — one tool-call artifact, resolved by `source` (user modal / synthetic pattern / ai).
export interface SelectSpec {
  id: string;
  prompt: string;
  options: SelectOption[];
  multi?: boolean;
  view?: "list" | "tree";
  source?: "user" | "pattern" | "ai";
  patternAnswer?: string[];
}
export interface SelectAnswer {
  id: string;
  selected: string[];
}

// A fan-out group. A join on this group fires when `size` members have ARRIVED — never by checking who is
// still running (a head between stages is momentarily idle but not done). Producer-declared, so a generic
// join (summarize) need know nothing about who feeds it; the runners carry the group.
export interface Group {
  id: string;
  size: number;
}

// What a node's start() kicks off; the engine runs it, then calls end() with the outcome.
export type NodeAction =
  | { modal: SelectSpec } // open a Select; the picked answer flows to end()
  | { agent: AgentSpec } // spawn a child head (a sub-agent run); its output flows to end()
  | { value: unknown }; // synchronous — flows straight to end()

export interface AgentSpec {
  agentId?: string; // run as a registered agent (its system + ceiling), else `system` defines a plain head
  system?: string;
  task: string;
  schema?: JsonSchema; // strict JSON the head must return (healed on mismatch)
  // Workspace paths (e.g. /workspace/src/x.ts) pre-read into the head's OPENING — the engine runs Read for
  // each (real results) and seeds them as the head's first tool calls, so it starts with the files in context.
  seedFiles?: string[];
}

// Where a node's end() routes the result.
export type Route =
  | { goTo: string; input?: unknown } // solo — continue as node `goTo` (1:1), keeps this head's name + group
  | { splitTo: string; inputs: FanMember[] } // fan out a NEW sibling group into node `splitTo`, one head per input
  | { goToAll: string; input?: unknown } // join — go to `goToAll` once EVERY member of this head's group has arrived
  | { done: string }; // terminal — this text is the graph's final message

export interface FanMember {
  name: string; // the head's member name (its chart label + routing identity)
  input?: unknown;
}

// What a node's start/end see: which head this is + its group. No reading other nodes' data — everything a
// step needs is PASSED in (input → output). The only extra is a workspace scan (a runner service).
export interface NodeCtx {
  sid: string;
  name: string;
  group?: Group;
  // Enumerate workspace file paths (under /workspace/), skipping `ignore`d dir names and keeping only the
  // given `extensions`. Walks via the directory list tool, so ignored trees (node_modules) are never entered.
  scan(opts?: { ignore?: string[]; extensions?: string[] }): Promise<string[]>;
}

// A named node — the start/end pair. `start(input)` kicks off the work; `end(input, response)` gets BOTH the
// input the head started with AND the agent/modal `response`, and composes the next step's input from them
// (the response is not automatically the next input). No node reads another node's data.
export interface GraphNode {
  start(ctx: NodeCtx, input: unknown): NodeAction | Promise<NodeAction>;
  end(ctx: NodeCtx, input: unknown, response: unknown): Route | Promise<Route>;
}
