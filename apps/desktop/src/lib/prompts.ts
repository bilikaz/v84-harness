import i18n, { LANGUAGES } from "./i18n.ts";

type Vars = Record<string, string>;
type Tree = { [k: string]: string | Tree };

const PROMPTS: Tree = {
  defaultChat: {
    system:
      "You are a helpful assistant serving a {{language}}-speaking user. " +
      "If the user writes in {{language}}, reply in {{language}}. Otherwise reply in English.",
  },
  workspace: {
    system:
      "You have access to the user's workspace folder through your file tools. " +
      "The workspace root is `/workspace`: write paths as `/workspace/…` (or workspace-relative). A path that " +
      "leaves `/workspace` is refused — nothing outside the workspace is reachable. " +
      "Example paths: `/workspace/src/index.ts`, `notes.md`. " +
      "Bash runs in the same root — use relative paths or `/workspace/…`.",
  },
  chatTitle: {
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

// Named `pt` (not `prompt`) to avoid colliding with the global window.prompt.
export function pt(key: string, vars?: Vars): string {
  const s = resolve(key) ?? key;
  const all: Vars = { language: languageName(), ...vars };
  return s.replace(/\{\{(\w+)\}\}/g, (_, k) => all[k] ?? "");
}
