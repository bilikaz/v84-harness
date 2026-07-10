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
  | { dialog: DialogSpec } // open a ReAct interview ON the graph session; the contract JSON flows to end()
  | { value: unknown }; // synchronous — flows straight to end()

// A ReAct dialog with a JSON contract: the engine posts `task` (which STATES the JSON the model must
// eventually return) and routes the surface session's turns to the normal model path — tools included —
// until a reply satisfies `schema`. The user converses freely in between; pasted images land with
// aliases. The parsed JSON string is the node's response.
export interface DialogSpec {
  task: string;
  schema: JsonSchema;
  // Run the interview on a FRESH child session (its own sub chat) as this registered agent — a
  // purpose-written system prompt + grounded toolset instead of the graph session's default assistant.
  // The graph session stays clean: it carries the node card and receives the contract JSON.
  agentId?: string;
  // Extension meta keys patched into the dialog's surface session at construction (e.g. comics'
  // generationJob) — ride to its tools on every call (see SessionRuntime).
  meta?: Record<string, unknown>;
  // Files LOADED FOR REAL into the surface's opening (images via ImageLoad, text via Read) — the
  // dialog starts with them already in context (and on the user's screen).
  seedFiles?: string[];
}

export interface AgentSpec {
  agentId?: string; // run as a registered agent (its system + ceiling), else `system` defines a plain head
  system?: string;
  task: string;
  schema?: JsonSchema; // strict JSON the head must return (healed on mismatch)
  // Extension meta keys patched into the spawned head's session at construction (e.g. comics'
  // generationJob) — ride to its tools on every call (see SessionRuntime).
  meta?: Record<string, unknown>;
  // Workspace paths (e.g. /workspace/src/x.ts) pre-read into the head's OPENING — the engine runs Read for
  // each (real results) and seeds them as the head's first tool calls, so it starts with the files in context.
  seedFiles?: string[];
}

// Where a node's end() routes the result. Termination is routing to the reserved `exit` node (BaseGraph
// owns it) — there is no terminal route value; the exit node renders the final output to chat.
export type Route =
  | { goTo: string; input?: unknown } // solo — continue as node `goTo` (1:1), keeps this head's name + group
  | { splitTo: string; inputs: FanMember[] } // fan out a NEW sibling group into node `splitTo`, one head per input
  | { goToAll: string; input?: unknown }; // join — go to `goToAll` once EVERY member of this head's group has arrived

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
  // In end(): the session id of the Call that produced this response (the spawned head / dialog
  // surface). Nodes use it to BUILD paths into the head's output (generated-images/jobs/<callSid>/)
  // instead of making the model transcribe them — a 26-char ULID retyped by a model is a typo farm.
  callSid?: string;
  // Enumerate workspace file paths (under /workspace/), skipping `ignore`d dir names and keeping only the
  // given `extensions`. Walks via the directory list tool, so ignored trees (node_modules) are never entered.
  scan(opts?: { ignore?: string[]; extensions?: string[] }): Promise<string[]>;
  // Run a registry tool against the session's workspace (the same gateway `scan` uses) — for a node's
  // DETERMINISTIC housekeeping (promote a file, write a record, compose a page). Null without a gateway.
  runTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string } | null>;
  // Reject the response and PARK the run at this node (resume state). The engine posts `message` to chat and
  // waits; a `continue` re-runs this node's start (e.g. re-surfaces a Select). Use for required input the
  // user left empty — never a silent default. Throws, so it does not return.
  break(message: string): never;
}

// A named node — the start/end pair. `start(input)` kicks off the work; `end(input, response)` gets BOTH the
// input the head started with AND the agent/modal `response`, and composes the next step's input from them
// (the response is not automatically the next input). No node reads another node's data.
export interface GraphNode {
  start(ctx: NodeCtx, input: unknown): NodeAction | Promise<NodeAction>;
  end(ctx: NodeCtx, input: unknown, response: unknown): Route | Promise<Route>;
}
