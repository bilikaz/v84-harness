import { agentsForContext, type Agent } from "../../../agents.ts";
import type { ToolSpec } from "../../types.ts";

// Sub-agent catalog + name resolution + the stable schema pair. Helpers shared by the ListAgents /
// RunAgent engine tools (and exercised directly by tests). Stable schemas so provider prompt caches hold.

export const LIST_AGENTS = "ListAgents";
export const RUN_AGENT = "RunAgent";

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

export function catalogAgents(hasWorkspace: boolean): Agent[] {
  return agentsForContext(hasWorkspace).filter((a) => a.name.trim());
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
