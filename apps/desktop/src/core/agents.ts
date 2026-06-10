import { stripFences } from "../lib/format.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// Agents store — reusable playbooks. Each is a name + description plus a pair of
// markdown documents: a `system` (how to behave / standing instructions) and a
// `user` (the task to run). Executing one spins up a session with system as the
// system prompt and user as the first message. The description is a short,
// plain-language summary of what the agent does — surfaced to the (upcoming)
// "run agent" tool so one agent can pick and orchestrate others.
const KEY = "v84-harness:agents";
const LEGACY_KEY = "v84-harness:procedures"; // pre-rename storage; migrated on first load

// Optional output contract. When set, the chat engine validates the agent's
// final turn against it and heals (re-prompts) on failure — see the heal layer
// in providers/client.ts + the `validate` path in core/sessions/driver.ts.
// Lightweight by design (no JSON Schema dependency): require valid JSON,
// optionally with given top-level keys.
export interface AgentOutput {
  json: boolean; // the final answer must parse as JSON
  required?: string[]; // required top-level keys (implies a JSON object)
}

export interface Agent {
  id: string;
  name: string;
  description: string; // short summary — what this agent does (used by orchestration)
  system: string; // markdown
  user: string; // markdown
  output?: AgentOutput; // optional validated-output contract (drives heal)
}

const SEED: Agent[] = [
  {
    id: "review-diff",
    name: "Review a diff",
    description: "Reviews a supplied diff for correctness, security, and style, grouped by severity.",
    system:
      "# Reviewer\n\nYou are a meticulous senior engineer. Review the supplied diff for correctness, security, and style. Be concise; cite file:line.",
    user: "Review the following diff and list findings grouped by severity:\n\n```diff\n<paste diff here>\n```",
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
    output: p.output && typeof p.output === "object" ? p.output : undefined,
  };
}

// Build a validator for an agent's output contract, or undefined when there's
// nothing to enforce. The returned fn THROWS on a rejected answer — that's what
// triggers a heal in the turn loop. Shape matches core/sessions/driver.ts's
// `Validate` ((text) => void) structurally, so no import is needed.
export function buildValidator(output?: AgentOutput): ((text: string) => void) | undefined {
  if (!output || (!output.json && !output.required?.length)) return undefined;
  const required = output.required ?? [];
  return (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch (e) {
      throw new Error(`output is not valid JSON: ${errorMessage(e)}`);
    }
    if (required.length) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`expected a JSON object with key(s): ${required.join(", ")}`);
      }
      const missing = required.filter((k) => !(k in (parsed as Record<string, unknown>)));
      if (missing.length) throw new Error(`missing required key(s): ${missing.join(", ")}`);
    }
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
  const a: Agent = { id: crypto.randomUUID(), name, description: "", system: "", user: "" };
  store.set([...store.get(), a]);
  return a.id;
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
