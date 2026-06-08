import { useSyncExternalStore } from "react";

// Procedures store — reusable playbooks. Each is a pair of markdown documents:
// a `system` (how to behave / standing instructions) and a `user` (the task to
// run). Executing one spins up a session with system as the system prompt and
// user as the first message. localStorage now; core/IPC + files later.
const KEY = "v84-harness:procedures";

export interface Procedure {
  id: string;
  name: string;
  system: string; // markdown
  user: string; // markdown
}

const SEED: Procedure[] = [
  {
    id: "review-diff",
    name: "Review a diff",
    system:
      "# Reviewer\n\nYou are a meticulous senior engineer. Review the supplied diff for correctness, security, and style. Be concise; cite file:line.",
    user: "Review the following diff and list findings grouped by severity:\n\n```diff\n<paste diff here>\n```",
  },
];

// Coerce a persisted entry into a complete Procedure — guards against partial /
// older-shape records (missing name/system/user) that would otherwise surface as
// undefined fields after a reload.
function normalize(p: Partial<Procedure>): Procedure {
  return {
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? "",
    system: p.system ?? "",
    user: p.user ?? "",
  };
}

function load(): Procedure[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(normalize);
    }
  } catch {
    /* fall through to seed */
  }
  return SEED;
}

let procedures: Procedure[] = load();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(procedures));
  } catch {
    /* ignore */
  }
}

export function getProcedures(): Procedure[] {
  return procedures;
}

// Add a blank procedure and return its id (for immediate editing).
export function createProcedure(name: string): string {
  const p: Procedure = { id: crypto.randomUUID(), name, system: "", user: "" };
  procedures = [...procedures, p];
  persist();
  emit();
  return p.id;
}

export function saveProcedure(id: string, patch: Partial<Omit<Procedure, "id">>): void {
  procedures = procedures.map((p) => (p.id === id ? { ...p, ...patch } : p));
  persist();
  emit();
}

export function deleteProcedure(id: string): void {
  procedures = procedures.filter((p) => p.id !== id);
  persist();
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useProcedures(): Procedure[] {
  return useSyncExternalStore(subscribe, getProcedures, getProcedures);
}
