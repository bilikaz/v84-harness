import i18n, { LANGUAGES } from "../lib/i18n.ts";

// The one place every NON-tool prompt in core lives — system blocks, the auto-naming and compaction
// prompts, the async-delivery notice. Tool prompts stay inside their tool (its description/output is part
// of the tool's contract), and an agent's `system` is part of its definition; everything else is here so
// prompts are greppable in one file instead of scattered through core.

type Vars = Record<string, string>;
type Tree = { [k: string]: string | Tree };

const PROMPTS = {
  defaultChat: {
    system:
      "You are a helpful assistant serving a {{language}}-speaking user. " +
      "If the user writes in {{language}}, reply in {{language}}. Otherwise reply in English.",
  },
  workspace: {
    // {{tools}} is filled with the SESSION'S advertised workspace tools (composeSystem) — naming the
    // exact set stops small models from inventing read_file/write_file-style names, and naming only
    // the advertised set keeps prose and specs from disagreeing.
    system:
      "You have access to the user's workspace folder through these tools: {{tools}}. Use EXACTLY these " +
      "names — no other file tool exists here. " +
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
  // Split save/search so each part is advertised ONLY with its tool present — prose naming an absent
  // tool gets it fabricated from the description (schema-less SaveMemory calls in grounded sub chats).
  memory: {
    save:
      "You have a persistent memory (a shared knowledgebase). When you learn something worth keeping — " +
      "facts, decisions, the user's preferences, project details — save it with SaveMemory (scope " +
      "`private` for just this user, `public` to share with everyone), and use EditMemory / DeleteMemory " +
      "to keep records current.",
    search:
      "You can search the persistent memory (a shared knowledgebase). When you need information that " +
      "isn't in this conversation, search first with SearchMemory before asking or assuming: " +
      // Param names MUST match the SearchMemory tool schema (keywords/phrase). They were sparse/dense, which the tool ignores.
      "pass a `keywords` list (lexical) and/or a related `phrase` (semantic) — both is best. SearchMemory " +
      "returns snippets + record ids; read a full record with GetMemory.",
  },
  agents: {
    // Always shown when the agent tools are advertised (top-level sessions; children don't orchestrate).
    system:
      "You can delegate work to sub-agents. A built-in General agent is always available, alongside any custom " +
      "agents the user has defined — call ListAgents to see what's there (each agent's name, what it does, and the " +
      "input it expects) before picking one. Start a run with RunAgent; pass several runs in one call to fan work " +
      "out concurrently. Each sub-agent runs in its own fresh session and can't see this conversation, so make every " +
      "task self-contained — include the content to work on, the constraints, and the output you want back.",
    // Sub-agents always run in the background (the sync wait-for-all mode is gone).
    async:
      "Delegation is asynchronous: RunAgent, AskAgent and ResumeAgent all return as soon as the agents start — the " +
      "reply is NOT inline. Don't wait, stall, or poll ActiveAgents for them: if you have other work carry on, and " +
      "if you have nothing else to do just END YOUR TURN. When each finishes you'll get a [runtime] notice telling " +
      "you to read its result with getAgentContent.",
  },
  chatTitle: {
    user:
      "Generate a concise 3-6 word title for THIS conversation. Do not add the word \"conversation\" in it. " +
      "Reply with ONLY the title — no quotes, no trailing punctuation.",
  },
  gallery: {
    system:
      "A gallery page composer is available: it lays IMAGES out into reviewed page layouts and renders a " +
      "print-quality A4 PNG (photo galleries, postcards, comic pages). Layouts take {{counts}} images. " +
      "Flow: call GalleryOptions({count}) to see that count's layout options (previews + descriptions, " +
      "handles like \"4-1\"), then GalleryCompose({templateId, images: [...]}) with the slot images in " +
      "reading order (workspace paths and/or img-N aliases). Optional masthead fields, each with a fixed home: " +
      "title (big, left), date (top-right line 1), credit (top-right line 2), accent (color).",
  },
  compact: {
    system: "You compress conversations into faithful, self-contained summaries.",
    instruction:
      "Summarize the entire conversation above into a compact but COMPLETE summary that can replace the full " +
      "history. Preserve: the user's goals and constraints, key decisions and their rationale, important facts, " +
      "file/code state and paths touched, tool results that still matter, and any open tasks or next steps. If " +
      "the conversation contains media references (img-N / vid-N aliases), end with a 'Media references' section " +
      "listing each one that still matters as `img-N: one-line description` — the aliases stay usable as image " +
      "generation/composition references after compaction. Use " +
      "clear sections. Omit nothing the assistant would need to continue seamlessly. Output only the summary.",
  },
} satisfies Record<string, Record<string, string>>;

// The valid `category.key` strings, derived from PROMPTS — so pt("workspce.system") is a compile error.
type PromptKey = { [C in keyof typeof PROMPTS]: `${C & string}.${keyof (typeof PROMPTS)[C] & string}` }[keyof typeof PROMPTS];

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

// Named `pt` (not `prompt`) to avoid colliding with the global window.prompt. `key` is constrained to
// the real prompt keys, so a typo fails to compile instead of silently rendering the key string.
export function pt(key: PromptKey, vars?: Vars): string {
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
  // Always the array form — getAgentContent's schema takes `ids: [...]`, so a bare `getAgentContent(1)`
  // shorthand would invite the model to call it with a non-array.
  const call = `getAgentContent([${aliases.join(", ")}])`;
  return `[runtime] Sub-agent${one ? "" : "s"} ${list} ${one ? "has" : "have"} finished. Call ${call} to read ${one ? "its result" : "their results"}.`;
}
