// LLM debug logging. On by default in dev.
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

export const llmLog = new ConsoleLogger("llm", { isDebugEnabled: llmDebugEnabled });
