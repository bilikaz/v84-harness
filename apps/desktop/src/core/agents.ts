import { createStore } from "../lib/store.ts";
import { type ToolName, type ToolPermission } from "./tools/types.ts";

// Agents store — reusable playbooks (system + user markdown) executed as sessions.
const KEY = "v84-harness:agents";
const LEGACY_KEY = "v84-harness:procedures"; // pre-rename storage; migrated on first load

// An agent's tool CEILING — the effective per-call permission is the STRICTER of
// this and the workspace policy (min); an agent can restrict but never extend it.
export type AgentTools = Record<ToolName, ToolPermission>;
// Empty default = no ceiling set; effectiveMode treats a missing entry as 2 (allow), so an agent only ever restricts.
export const AGENT_TOOLS_DEFAULT: AgentTools = {};

export interface Agent {
  id: string;
  name: string;
  description: string;
  system: string;
  user: string;
  workspace: boolean;
  tools: AgentTools;
}

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

const store = createStore<Agent[]>(KEY, SEED, () => read(KEY) ?? read(LEGACY_KEY));

export function getAgents(): Agent[] {
  return store.get();
}

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
