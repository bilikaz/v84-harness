import i18n, { LANGUAGES } from "./i18n.ts";

// Prompt registry — model-facing messages keyed "<segment>.<role>" with {{var}} interpolation; single English catalog, {{language}} injected automatically.
type Vars = Record<string, string>;
type Tree = { [k: string]: string | Tree };

const PROMPTS: Tree = {
  defaultChat: {
    system:
      "You are a helpful assistant serving a {{language}}-speaking user. " +
      "If the user writes in {{language}}, reply in {{language}}. Otherwise reply in English.",
  },
  workspace: {
    // Appended to the system message when a session has file tools — the virtual root (ADR-0007) is invisible to the model unless we say so.
    system:
      "You have access to the user's workspace folder through your file tools. " +
      "The workspace root is mounted as `/`: every path is workspace-relative, a leading `/` means the workspace root itself " +
      "(never the host filesystem), and nothing outside the workspace is reachable. " +
      "Example paths: `/src/index.ts`, `notes.md`. " +
      "Bash is the exception — it is a real shell whose working directory is the workspace root; use relative paths there.",
  },
  chatTitle: {
    // Appended as a final user turn after the real conversation is resent.
    user:
      "Generate a concise 3-6 word title for THIS conversation. Do not add conversation word in it" +
      "Reply with ONLY the title — no quotes, no trailing punctuation.",
  },
};

function resolve(key: string): string | undefined {
  let node: string | Tree | undefined = PROMPTS;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function languageName(): string {
  return LANGUAGES.find((l) => l.code === i18n.language)?.name ?? "English";
}

// Unknown key returns the key; named `pt` (not `prompt`) to avoid colliding with the global window.prompt.
export function pt(key: string, vars?: Vars): string {
  const s = resolve(key) ?? key;
  const all: Vars = { language: languageName(), ...vars };
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => all[k] ?? "");
}
