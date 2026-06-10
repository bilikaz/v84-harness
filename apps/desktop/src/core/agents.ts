import { createStore } from "../lib/store.ts";
import { ALL_TOOLS, type GatedTool, type ToolMode } from "./tools/types.ts";

// Agents store — reusable playbooks. Each is a name + description plus a pair of
// markdown documents: a `system` (how to behave / standing instructions) and a
// `user` (the task to run). Executing one spins up a session with system as the
// system prompt and user as the first message. The description is a short,
// plain-language summary of what the agent does — surfaced to the ListAgents
// tool so one agent can pick and orchestrate others.
const KEY = "v84-harness:agents";
const LEGACY_KEY = "v84-harness:procedures"; // pre-rename storage; migrated on first load

// An agent's tool CEILING. The effective per-call permission is the STRICTER of
// this and the workspace policy (min) — an agent can restrict what a workspace
// grants (a read-only reviewer in a write-enabled workspace) but never extend
// it. All-auto by default: an unconfigured agent simply inherits the workspace.
export type AgentTools = Record<GatedTool, ToolMode>;
export const AGENT_TOOLS_DEFAULT: AgentTools = Object.fromEntries(ALL_TOOLS.map((t) => [t, 2])) as AgentTools;

export interface Agent {
  id: string;
  name: string;
  description: string; // short summary — what this agent does (used by orchestration)
  system: string; // markdown
  user: string; // markdown — the DEFAULT task for manual runs; orchestrators supply their own
  workspace: boolean; // true = runs bound to a workspace (file tools); false = pure chat, never gets file access
  tools: AgentTools; // per-tool ceiling within the workspace policy (workspace agents only)
}

// First-run library: one of each kind — a chat agent you can fire anywhere for
// a quick smile, and a workspace agent that shows off the file tools. The
// reviewer's tool ceiling makes its read-only promise REAL: writes and shell
// are off no matter what the workspace grants.
const SEED: Agent[] = [
  {
    id: "joke-teller",
    name: "Joke teller",
    description: "Tells a short, clean joke about a given topic. Input: the topic (anything works).",
    system:
      "# Joke teller\n\nYou are a stand-up comedian with impeccable timing. Given a topic, reply with ONE short, clever, " +
      "family-friendly joke about it — setup and punchline, nothing else. No explanations, no 'here's a joke' preamble. " +
      "If the topic is in another language, joke in that language.",
    user: "Tell me a joke about programmers.",
    workspace: false,
    tools: { ...AGENT_TOOLS_DEFAULT },
  },
  {
    id: "code-reviewer",
    name: "Code reviewer",
    description:
      "Reviews code in the workspace: explores the relevant files and reports findings by severity with file:line references. " +
      "Input: what to review (paths, a feature, or 'everything').",
    system:
      "# Code reviewer\n\nYou are a meticulous senior engineer reviewing code in the user's workspace. " +
      "Explore with List/Grep, Read the relevant files, and review for correctness, security, and maintainability. " +
      "You cannot modify files — you only read and report. " +
      "Reply with findings grouped by severity (critical / warning / nit), each citing file:line and a one-line fix suggestion. " +
      "If everything looks good, say so briefly instead of inventing problems.",
    user: "Review the code in this workspace. Start from `/`, focus on what looks most load-bearing.",
    workspace: true,
    tools: { ...AGENT_TOOLS_DEFAULT, Write: 0, Edit: 0, CreateFolder: 0, Bash: 0 },
  },
];

// Coerce a persisted entry into a complete Agent — guards against partial /
// older-shape records (missing name/description/system/user) that would
// otherwise surface as undefined fields after a reload.
function normalize(p: Partial<Agent>): Agent {
  return {
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? "",
    description: p.description ?? "",
    system: p.system ?? "",
    user: p.user ?? "",
    workspace: p.workspace === true,
    tools: { ...AGENT_TOOLS_DEFAULT, ...(p.tools ?? {}) },
  };
}

function read(key: string): Agent[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(normalize);
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Initial read with one-time migration from the pre-rename "procedures" key.
const store = createStore<Agent[]>(KEY, SEED, () => read(KEY) ?? read(LEGACY_KEY));

export function getAgents(): Agent[] {
  return store.get();
}

// Add a blank agent and return its id (for immediate editing).
export function createAgent(name: string): string {
  const a: Agent = {
    id: crypto.randomUUID(),
    name,
    description: "",
    system: "",
    user: "",
    workspace: false,
    tools: { ...AGENT_TOOLS_DEFAULT },
  };
  store.set([...store.get(), a]);
  return a.id;
}

export function getAgent(id: string): Agent | undefined {
  return store.get().find((a) => a.id === id);
}

// The agents runnable in a given context: a workspace session can run anything;
// a pure-chat context (no workspace) can only run chat agents — there is
// nothing to bind a workspace agent to. Used by the right-panel list and the
// sub-agent catalog alike.
export function agentsForContext(hasWorkspace: boolean): Agent[] {
  return store.get().filter((a) => hasWorkspace || !a.workspace);
}

export function saveAgent(id: string, patch: Partial<Omit<Agent, "id">>): void {
  store.set(store.get().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}

export function deleteAgent(id: string): void {
  store.set(store.get().filter((a) => a.id !== id));
}

export function useAgents(): Agent[] {
  return store.use();
}
