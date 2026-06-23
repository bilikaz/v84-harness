import { agentsForContext, type Agent } from "../../../agents.ts";
import { contextLimit, ensureLoaded, getSession, getSessions, getStreamingIds, getUserPausedIds } from "../../../sessions/store.ts";
import { resolveMain } from "../../../settings.ts";
import type { ErrorKind, Session } from "../../../sessions/types.ts";
import { cap } from "../../base.ts";
import type { ToolSpec } from "../../types.ts";

// Sub-agent catalog + name resolution + the stable schemas, plus the live-team helpers (roster, aliases,
// status, memory). Shared by the orchestration engine tools (and exercised directly by tests). Stable
// schemas so provider prompt caches hold.

export const LIST_AGENTS = "ListAgents";
export const RUN_AGENT = "RunAgent";
export const ACTIVE_AGENTS = "ActiveAgents";
export const ASK_AGENT = "AskAgent";
export const RESUME_AGENT = "ResumeAgent";
export const GET_AGENT_CONTENT = "getAgentContent";

export const LIST_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: LIST_AGENTS,
    description:
      "List the stored agents you can run as sub-agents: their names, what they do, and what input they expect.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export const RUN_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: RUN_AGENT,
    description:
      "Run stored agents as sub-agents, each in its own fresh session, and get their final answers. " +
      "All runs in one call execute CONCURRENTLY — to fan work out, pass several runs in a single call. " +
      "Use ListAgents to see what is available. The same agent may appear in several runs with different tasks.",
    parameters: {
      type: "object",
      properties: {
        runs: {
          type: "array",
          minItems: 1,
          description: "The sub-agent runs to start, all at once. The same agent may appear in several runs.",
          items: {
            type: "object",
            properties: {
              agent: { type: "string", description: "The agent's name exactly as ListAgents lists it." },
              task: {
                type: "string",
                description:
                  "The task for this run. Self-contained — the sub-agent cannot see this conversation, so include everything it needs (content to work on, constraints, expected output).",
              },
            },
            required: ["agent", "task"],
            additionalProperties: false,
          },
        },
      },
      required: ["runs"],
      additionalProperties: false,
    },
  },
};

export const ACTIVE_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: ACTIVE_AGENTS,
    description:
      "List the sub-agents you have running this session — their short id (1, 2, …), status, and how full each " +
      "one's memory is. Use it before AskAgent/ResumeAgent to see who is available and which are near their limit.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export const ASK_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: ASK_AGENT,
    description:
      "Send a follow-up message to sub-agents you already started, by their short id — they answer from their " +
      "existing context (reusing what they already did). Talk to several at once by passing several runs. For " +
      "delegating more work or asking questions; to merely revive a crashed run, use ResumeAgent instead.",
    parameters: {
      type: "object",
      properties: {
        runs: {
          type: "array",
          minItems: 1,
          description: "The agents to message, all at once.",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "The agent's short id from ActiveAgents / a run result (1, 2, …)." },
              message: { type: "string", description: "What to ask or tell this agent. Self-contained — it only sees its own conversation." },
            },
            required: ["id", "message"],
            additionalProperties: false,
          },
        },
      },
      required: ["runs"],
      additionalProperties: false,
    },
  },
};

export const RESUME_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: RESUME_AGENT,
    description:
      "Resume sub-agents whose run FAILED or was interrupted (e.g. lost connection) — each continues from exactly " +
      "where it stopped, with all its work preserved. No message is sent: it just finishes its task. Address each " +
      "by its short id; resume several at once. Do NOT use this for an out-of-memory failure (it would re-fail) or " +
      "to send new instructions (use AskAgent).",
    parameters: {
      type: "object",
      properties: {
        runs: {
          type: "array",
          minItems: 1,
          description: "The agents to resume, all at once.",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "The agent's short id from the failure message (1, 2, …)." },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      required: ["runs"],
      additionalProperties: false,
    },
  },
};

export const GET_CONTENT_SCHEMA: ToolSpec = {
  type: "function",
  function: {
    name: GET_AGENT_CONTENT,
    description:
      "Read the final output of sub-agents that have FINISHED, by their short id (1, 2, …) — one or several at " +
      "once. Returns each agent's result, or its failure note. Only call it for agents you have been told are " +
      "finished; an agent still running cannot be read this way (you will be informed when it is done).",
    parameters: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          minItems: 1,
          description: "The finished agents to read, by short id (1, 2, …).",
          items: { type: "integer", description: "A finished agent's short id." },
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
};

// ── live team (roster, aliases, status, memory) ───────────────────────────────

// A child is "pending" — not yet readable — while it is streaming (running) or the user has paused
// it. Both mean "not done": only a finished/failed/stopped terminal carries a readable result.
export function isChildPending(s: Session): boolean {
  return getStreamingIds().has(s.id) || getUserPausedIds().has(s.id);
}

// Read finished children's final output (their last assistant text), or a failure note for an
// errored/out-of-memory one — keyed by short id. Shared by the getAgentContent tool and the engine's
// synthetic delivery. Callers handle the still-pending case (the tool erases; delivery only passes
// terminal ids). Loads each child's history first so the last-text read sees real content.
export async function collectAgentContent(parentSid: string, ids: unknown[]): Promise<{ output: string; childIds: string[] }> {
  const resolved = ids.map((id) => ({ id, child: resolveChild(parentSid, id) }));
  const childIds = resolved.filter((r) => r.child).map((r) => r.child!.id);
  await Promise.all(childIds.map((cid) => ensureLoaded(cid)));
  const answers = resolved.map(({ id, child }) => {
    if (!child) return `agent (id: ${String(id)}): no sub-agent #${String(id)}.`;
    const alias = aliasOf(child);
    if (child.errorKind) return `agent (id: ${alias}): ${failureNote(alias, child.title, child.errorKind, lastAgentText(child.id))}`;
    return `agent (id: ${alias}): ${cap(lastAgentText(child.id)) || "(the sub-agent returned no text)"}`;
  });
  return { output: cap(answers.join("\n\n")), childIds };
}

// A sub-agent's final answer — its last assistant message's text.
export function lastAgentText(sid: string): string {
  const msgs = getSession(sid)?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i].text ?? "";
  return "";
}

// A parent's child sub-agents, ordered by their short handle (#1, #2, … in spawn order).
export function childrenOf(parentSid: string): Session[] {
  return getSessions()
    .filter((s) => s.parentId === parentSid)
    .sort((a, b) => aliasOf(a) - aliasOf(b));
}

// A child's short handle, parsed from the trailing "#n" of its title (0 if none — only children carry one,
// and pre-existing children spawned before this scheme have no "#n" and stay unaddressable).
export function aliasOf(s: Session): number {
  const m = /#(\d+)\s*$/.exec(s.title);
  return m ? Number(m[1]) : 0;
}

// Resolve a short id (1, 2, …) to the child — lenient about quotes/spaces the model may add.
export function resolveChild(parentSid: string, id: unknown): Session | undefined {
  const n = Number(String(id).replace(/['"\s]/g, ""));
  if (!Number.isInteger(n) || n < 1) return undefined;
  return childrenOf(parentSid).find((s) => aliasOf(s) === n);
}

// A sub-agent's current state, derived live: streaming → working; a stored errorKind → failed/out-of-memory.
export function agentStatus(s: Session): "working" | "out of memory" | "failed" | "idle" {
  if (getStreamingIds().has(s.id)) return "working";
  if (s.errorKind === "capacity") return "out of memory";
  if (s.errorKind) return "failed";
  return "idle";
}

// Context occupancy as a percent (0–100), or null when the window is unknown — the roster's memory gauge.
export function memoryPct(s: Session): number | null {
  const cfg = resolveMain();
  const limit = cfg ? contextLimit(cfg) : 0;
  if (!limit) return null;
  return Math.min(100, Math.round(((s.usedTokens ?? 0) / limit) * 100));
}

// The roster line for one agent: id, name, status, memory, and the task it was given (a label, NOT its
// response — the orchestrator already has responses in its transcript; echoing them would duplicate/bloat).
function rosterLine(s: Session): string {
  const mem = memoryPct(s);
  return `- ${s.title || "(untitled)"} — ${agentStatus(s)}${mem === null ? "" : ` — memory ${mem}%`}`;
}

// The orchestrator's live team, or a hint that it has none. Shown by ActiveAgents and on a bad id.
export function rosterHint(parentSid: string): string {
  const kids = childrenOf(parentSid);
  if (!kids.length) return "You have no sub-agents running — start some with RunAgent.";
  return "Your sub-agents:\n" + kids.map(rosterLine).join("\n");
}

// A failed run's result — names the cause AND the exact next call, so the orchestrator acts without
// deliberation. Capacity (out-of-memory) is NOT resumable (re-prefills the overflow); everything else is.
export function failureNote(alias: number, name: string, kind: ErrorKind | undefined, lastText: string): string {
  const tail = lastText ? ` Its last output:\n${cap(lastText)}` : "";
  if (kind === "capacity") {
    return (
      `sub-agent ${alias} ("${name}") ran out of memory (context full) — do NOT ResumeAgent it (it would re-fail). ` +
      `Ask it to summarize what it has with AskAgent {"runs":[{"id":${alias},"message":"summarize your findings so far"}]}, ` +
      `or start a fresh run with RunAgent.${tail}`
    );
  }
  return (
    `sub-agent ${alias} ("${name}") failed (connection lost) — its work is saved. ` +
    `Resume it with ResumeAgent {"runs":[{"id":${alias}}]} to continue from where it stopped.${tail}`
  );
}

// The built-in General agent — always summonable so an orchestrator can delegate ad-hoc work with no setup.
// It inherits the CALLER's context for free: spawned into the parent's container with this empty system + no
// tool ceiling, and getAgent("general") is undefined, so capabilityContext is container-driven — the child
// gets the workspace's file tools when there's a workspace, the live base system either way. The `workspace`
// flag just mirrors the context so it lists everywhere.
export const GENERAL_AGENT_ID = "general";
function generalAgent(hasWorkspace: boolean): Agent {
  return {
    id: GENERAL_AGENT_ID,
    name: "General agent",
    description: "A general-purpose helper with your own tools and context — give it any task to do on your behalf.",
    system: "",
    user: "",
    workspace: hasWorkspace,
    tools: {},
  };
}

export function catalogAgents(hasWorkspace: boolean): Agent[] {
  const stored = agentsForContext(hasWorkspace).filter((a) => a.name.trim());
  // Inject the built-in General agent unless the user already defined one by that name (theirs wins, no clash).
  const hasGeneral = stored.some((a) => normalizeName(a.name) === "general agent");
  return hasGeneral ? stored : [generalAgent(hasWorkspace), ...stored];
}

export function agentToolSchemas(hasWorkspace: boolean): ToolSpec[] {
  return catalogAgents(hasWorkspace).length ? [LIST_SCHEMA, RUN_SCHEMA] : [];
}

function catalogLines(agents: Agent[]): string {
  return agents
    .map((a) => `- "${a.name.trim()}" — ${a.description.trim() || "(no description)"}`)
    .join("\n");
}

export function listAgentsOutput(hasWorkspace: boolean): string {
  const agents = catalogAgents(hasWorkspace);
  if (!agents.length) return "No agents are available in this context.";
  return (
    `Available agents:\n${catalogLines(agents)}\n\n` +
    `Run them with RunAgent {runs: [{agent, task}, …]} — pass each agent's name without the quotes. ` +
    `All entries in one call run concurrently; put everything you want in parallel into ONE call. ` +
    `The SAME agent can appear in several entries with different tasks — e.g. five parallel runs of one ` +
    `reviewer agent, each focused on a different aspect.`
  );
}

function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/\s*\[[^\]]*\]\s*$/, "") // bracket suffix FIRST — it may trail a closing quote
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .toLowerCase();
}

export function resolveAgent(name: string, hasWorkspace: boolean): Agent | string {
  const agents = catalogAgents(hasWorkspace);
  if (!agents.length) return "No agents are available in this context.";
  const wanted = normalizeName(name);
  const matches = agents.filter((a) => normalizeName(a.name) === wanted);
  if (matches.length === 1) return matches[0];
  const problem = matches.length ? `agent name "${name}" is ambiguous` : `no agent is named "${name}"`;
  return `${problem}. Valid agents:\n${catalogLines(agents)}`;
}
