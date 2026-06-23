import i18n, { LANGUAGES } from "../lib/i18n.ts";

// The one place every NON-tool prompt in core lives — system blocks, the auto-naming and compaction
// prompts, the async-delivery notice. Tool prompts stay inside their tool (its description/output is part
// of the tool's contract), and an agent's `system` is part of its definition; everything else is here so
// prompts are greppable in one file instead of scattered through core.

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
      "Example paths: `/workspace/src/index.ts`, `notes.md`.",
  },
  browser: {
    system:
      "You can open and read web pages through your browser tools. Windows are yours for this session, " +
      'addressed by short ids (1, 2, …). REUSE a window: to follow a link or move on, navigate the one you ' +
      "already have (Browser {id: 1, url}) instead of opening new ones — check ActiveBrowsers for your ids " +
      "and never guess them. Read a page with BrowserContent; if you can't see images yourself, use " +
      "BrowserDescribe to understand its structure (forms, buttons, layout). When a page needs a login, a " +
      "captcha, or a popup dismissed, ASK THE USER to handle it in the window — they can act on it and tell " +
      "you to continue.",
  },
  memory: {
    system:
      "You have a persistent memory (a shared knowledgebase) through the memory tools. " +
      "When you learn something worth keeping — facts, decisions, the user's preferences, project details — save it with " +
      "SaveMemory (scope `private` for just this user, `public` to share with everyone). " +
      "When you need information that isn't in this conversation, search first with SearchMemory before asking or assuming: " +
      "pass a regex as `sparse` and/or a natural-language description as `dense`. SearchMemory returns snippets + record ids; " +
      "read a full record with GetMemory, and use EditMemory / DeleteMemory to keep it current.",
  },
  chatTitle: {
    user:
      "Generate a concise 3-6 word title for THIS conversation. Do not add conversation word in it" +
      "Reply with ONLY the title — no quotes, no trailing punctuation.",
  },
  compact: {
    system: "You compress conversations into faithful, self-contained summaries.",
    instruction:
      "Summarize the entire conversation above into a compact but COMPLETE summary that can replace the full " +
      "history. Preserve: the user's goals and constraints, key decisions and their rationale, important facts, " +
      "file/code state and paths touched, tool results that still matter, and any open tasks or next steps. Use " +
      "clear sections. Omit nothing the assistant would need to continue seamlessly. Output only the summary.",
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

// Substitute {{vars}} (and the implicit {{language}}) into arbitrary text — used for user/workspace/plugin
// system messages so they can target the user's language the same way the built-in prompts do.
export function fill(text: string, vars?: Vars): string {
  const all: Vars = { language: languageName(), ...vars };
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => all[k] ?? "");
}

// Named `pt` (not `prompt`) to avoid colliding with the global window.prompt.
export function pt(key: string, vars?: Vars): string {
  return fill(resolve(key) ?? key, vars);
}

// The built-in default base prompt, RAW (with {{language}} visible) — shown in Settings as the reference.
export function defaultSystemPrompt(): string {
  return resolve("defaultChat.system") ?? "";
}

// The runtime notice that wakes a parent when async sub-agents finish — names them by short id and the exact
// call to read them. Framed as a [runtime] event (not the user's voice), and an actionable instruction so
// the parent fetches regardless of how it reads the role.
export function deliveryNudge(aliases: number[]): string {
  const one = aliases.length === 1;
  const list = aliases.map((n) => `#${n}`).join(", ");
  const call = one ? `getAgentContent(${aliases[0]})` : `getAgentContent([${aliases.join(", ")}])`;
  return `[runtime] Sub-agent${one ? "" : "s"} ${list} ${one ? "has" : "have"} finished. Call ${call} to read ${one ? "its result" : "their results"}.`;
}
