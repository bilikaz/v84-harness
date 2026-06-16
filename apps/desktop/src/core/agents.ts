import { useSyncExternalStore } from "react";

import { createListeners } from "./storage/consumer.ts";
import { newId } from "./ids.ts";
import type { StorageEngine } from "./storage/engine.ts";
import type { Ctx } from "./ctx.ts";
import { type ToolName, type ToolPermission } from "./tools/types.ts";
import { rootLog } from "../lib/logger/index.ts";
import { errorMessage } from "../lib/errors.ts";

// Agents — reusable playbooks (system + user markdown) run as sessions. Rows in the `agents` store
// of the active provider (ctx.storage — cloud when connected, local offline); in-memory + sync
// selectors (the engine reads getAgent() during a turn), async persist/hydrate that re-runs on swap.
const log = rootLog.child("agents");

export type AgentTools = Record<ToolName, ToolPermission>;
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
    id: p.id ?? newId(),
    name: p.name ?? "",
    description: p.description ?? "",
    system: p.system ?? "",
    user: p.user ?? "",
    workspace: p.workspace === true,
    tools: { ...AGENT_TOOLS_DEFAULT, ...(p.tools ?? {}) },
  };
}

let data: StorageEngine | null = null;
let agents: Agent[] = [];
const reg = createListeners();

// Agents are playbooks that follow the connection — they live in the ACTIVE provider (the cloud
// when connected, local offline), and re-hydrate on each swap. Seed-on-empty fills a fresh realm.
const repo = () => data?.repos().agents ?? null;

export function useAgentData(e: StorageEngine): void {
  data = e;
}

// Load rows; seed the defaults on a fresh store.
export async function hydrateAgents(): Promise<void> {
  const r = repo();
  try {
    if (!r) return;
    const rows = (await r.list()).map(normalize);
    if (rows.length === 0) {
      for (const a of SEED) await r.put(a);
      agents = SEED.map((a) => ({ ...a }));
    } else {
      agents = rows;
    }
  } catch (err) {
    log.warn("hydrate_failed", { error: errorMessage(err) });
    agents = SEED.map((a) => ({ ...a }));
  } finally {
    reg.notify();
  }
}

function persist(id: string): void {
  const a = agents.find((x) => x.id === id);
  const r = repo();
  if (a && r) void r.put(a).catch((e: unknown) => log.warn("persist_failed", { id, error: errorMessage(e) }));
}

// ── Selectors (sync) ─────────────────────────────────────────────────────────
export const getAgents = (): Agent[] => agents;
export const getAgent = (id: string): Agent | undefined => agents.find((a) => a.id === id);
export const agentsForContext = (hasWorkspace: boolean): Agent[] => agents.filter((a) => hasWorkspace || !a.workspace);

// ── Commands ───────────────────────────────────────────────────────────────
export function createAgent(name: string): string {
  const a: Agent = { id: newId(), name, description: "", system: "", user: "", workspace: false, tools: { ...AGENT_TOOLS_DEFAULT } };
  agents = [...agents, a];
  reg.notify();
  persist(a.id);
  return a.id;
}

export function saveAgent(id: string, patch: Partial<Omit<Agent, "id">>): void {
  agents = agents.map((a) => (a.id === id ? { ...a, ...patch } : a));
  reg.notify();
  persist(id);
}

export function deleteAgent(id: string): void {
  agents = agents.filter((a) => a.id !== id);
  reg.notify();
  const r = repo();
  if (r) void r.remove(id).catch((e: unknown) => log.warn("delete_failed", { id, error: errorMessage(e) }));
}

export const useAgents = (): Agent[] => useSyncExternalStore(reg.subscribe, () => agents, () => agents);

// Wired at init: inject ctx.storage. Hydration is awaited by init() (after ctx.storage is installed).
export function initAgents(ctx: Ctx): void {
  useAgentData(ctx.storage);
}
