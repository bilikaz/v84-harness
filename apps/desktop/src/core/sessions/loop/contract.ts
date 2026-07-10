// The contract module (implementation.md) — PURE: fault types, classify, reaction tables, budgets.
// One fault taxonomy for every level of the supervisor tree; same fault → same reaction, regardless
// of whose session it is. No engine imports — unit-testable in isolation.

export type JsonSchema = Record<string, unknown>;

// A session's contract: what a settled reply must satisfy, and who feeds the loop when it would
// otherwise self-resume (a present user, or the loop itself).
export interface Contract {
  schema?: JsonSchema; // { required: [...] }; absent → free-form (settle = final text)
  interactive: boolean;
}

// The faults a settling reply can raise. Level-specific faults (stream-broken, malformed-call) live
// with their level's unit mechanics; these are the CONTRACT-level kinds every loop shares.
export type FaultKind =
  | "errored" // the response production itself failed (provider error, dead turn)
  | "unparseable" // no JSON where the contract demands one (includes wrong shape)
  | "missing-fields" // parses, but required fields absent — correctable by name
  | "invalid"; // a custom output validator rejected the reply — correctable with ITS message

export type Verdict =
  | { ok: true; text: string }
  | { ok: false; fault: FaultKind; missing?: string[]; correction?: string };

// What a loop does about a fault. `wait` = hand the next move to the user (interactive only);
// `escalate` = the budget is spent (or the fault is fatal) — settle not-ok, the level above decides.
export type Reaction = "resume" | "correct" | "wait" | "escalate";

// ONE table. The single mode-dependent column is what a user's presence changes: automatic re-drives
// make no sense mid-interview (the broken reply may BE the model's question to the user).
const REACTIONS: Record<FaultKind, { interactive: Reaction; autonomous: Reaction }> = {
  errored: { interactive: "wait", autonomous: "resume" },
  unparseable: { interactive: "wait", autonomous: "resume" },
  "missing-fields": { interactive: "correct", autonomous: "correct" },
  invalid: { interactive: "correct", autonomous: "correct" },
};

// The reaction for a fault under a contract, budget applied: budgets bound AUTOMATIC reactions only —
// a user can always steer past a spent budget; an autonomous loop escalates.
export function reactionFor(fault: FaultKind, contract: Contract, healsSpent: number, budget: number): Reaction {
  const reaction = REACTIONS[fault][contract.interactive ? "interactive" : "autonomous"];
  if (reaction === "wait") return reaction;
  if (healsSpent >= budget) return contract.interactive ? "wait" : "escalate";
  return reaction;
}

// classify — reply text → verdict. No schema means any settled text is the result.
export function classify(text: string, schema?: JsonSchema): Verdict {
  if (!schema) return { ok: true, text };
  const extracted = extractJson(text); // pull the JSON out of any prose/fences ONCE
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    return { ok: false, fault: "unparseable" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, fault: "unparseable" };
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const missing = required.filter((k) => !(k in (parsed as Record<string, unknown>)));
  return missing.length ? { ok: false, fault: "missing-fields", missing } : { ok: true, text: extracted };
}

// The targeted correction for a correctable fault — a validator's own message when it gave one,
// otherwise the missing-fields form. Safe to send because the reply parsed/streamed fine.
// (Unparseable output is NEVER re-sent: the reaction is a bare resume that drops the broken tail.)
export function correctionFor(v: Verdict): string {
  if (v.ok) return "";
  if (v.correction) return v.correction;
  return `Your JSON is missing required field(s): ${(v.missing ?? []).join(", ")}. Return the corrected JSON.`;
}

export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}
