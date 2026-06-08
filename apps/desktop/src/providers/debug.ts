// LLM debug logging. On by default in dev; toggle at runtime with
// `setLlmDebug(true/false)` (persists to localStorage) or in the console via
// `localStorage["v84-harness:llm-debug"] = "1" | "0"`. Gated so production stays
// quiet unless explicitly turned on.
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

// Log an LLM event when debug is on. `label` is the provider + phase, e.g.
// "openai →" / "openai ✗".
export function dlog(label: string, ...args: unknown[]): void {
  // console.log (not console.debug) so it shows at the DevTools default level —
  // console.debug is hidden unless "Verbose" is enabled.
  if (enabled) console.log(`[llm] ${label}`, ...args);
}
