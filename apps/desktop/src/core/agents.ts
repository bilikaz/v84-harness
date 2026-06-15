import { Consumer } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";
import { type ToolName, type ToolPermission } from "./tools/types.ts";

// Agents consumer — reusable playbooks (system + user markdown) executed as sessions.
// Persisted through ctx.storage like every other consumer.
const KEY = "v84-harness:agents";

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

class Agents extends Consumer<Agent[]> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, SEED);
  }

  protected override parse(raw: string): Agent[] {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(normalize) : this.defaults;
  }

  list(): Agent[] {
    return this.state;
  }
  find(id: string): Agent | undefined {
    return this.state.find((a) => a.id === id);
  }
  forContext(hasWorkspace: boolean): Agent[] {
    return this.state.filter((a) => hasWorkspace || !a.workspace);
  }
  create(name: string): string {
    const a: Agent = { id: crypto.randomUUID(), name, description: "", system: "", user: "", workspace: false, tools: { ...AGENT_TOOLS_DEFAULT } };
    this.commit([...this.state, a]);
    return a.id;
  }
  save(id: string, patch: Partial<Omit<Agent, "id">>): void {
    this.commit(this.state.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }
  remove(id: string): void {
    this.commit(this.state.filter((a) => a.id !== id));
  }
  useList = (): Agent[] => this.use();
}

let inst: Agents;
export function initAgents(ctx: Ctx): Agents {
  inst = new Agents(ctx);
  return inst;
}

// Module facades — the public API; thin delegates to the ctx-injected singleton.
export const getAgents = (): Agent[] => inst.list();
export const getAgent = (id: string): Agent | undefined => inst.find(id);
export const agentsForContext = (hasWorkspace: boolean): Agent[] => inst.forContext(hasWorkspace);
export const createAgent = (name: string): string => inst.create(name);
export const saveAgent = (id: string, patch: Partial<Omit<Agent, "id">>): void => inst.save(id, patch);
export const deleteAgent = (id: string): void => inst.remove(id);
export const useAgents = (): Agent[] => inst.useList();
