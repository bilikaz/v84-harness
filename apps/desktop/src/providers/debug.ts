// LLM debug logging. On by default in dev; toggle at runtime with
// `setLlmDebug(true/false)` (persists to localStorage) or in the console via
// `localStorage["v84-harness:llm-debug"] = "1" | "0"`. Gated so production stays
// quiet unless explicitly turned on.
import { ConsoleLogger } from "../lib/logger/index.ts";

const KEY = "v84-harness:llm-debug";

function initial(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored != null) return stored === "1";
  } catch {
    /* ignore */
  }
  return import.meta.env.DEV;
}

let enabled = initial();

export function setLlmDebug(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function llmDebugEnabled(): boolean {
  return enabled;
}

// The LLM layer's logger — `debug` events are gated by the flag above, so
// request/response dumps stay quiet unless LLM debug logging is on.
export const llmLog = new ConsoleLogger("llm", { isDebugEnabled: llmDebugEnabled });
