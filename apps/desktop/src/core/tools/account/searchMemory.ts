import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseAccountTool } from "./base.ts";
import { authedFetch } from "../../account.ts";
import { errorMessage } from "../../../lib/errors.ts";

interface Hit {
  id: string;
  score: number;
  scope: string;
  category: string | null;
  snippets: string[];
}

export class SearchMemory extends BaseAccountTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "SearchMemory",
        description:
          "Search the knowledgebase. Provide a regex (`sparse`, lexical) and/or a natural-language query (`dense`, semantic) — both is best. " +
          "scope: 'private' (yours), 'public' (shared), or 'both' (default). Returns matching snippets + record ids; use GetMemory to read a full record.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sparse: { type: "string", description: "A regex to match against the text (lexical/exact)." },
            dense: { type: "string", description: "A natural-language description of what you're looking for (semantic)." },
            scope: { type: "string", enum: ["private", "public", "both"], description: "Where to search. Default: both." },
            category: { type: "string", description: "Restrict public results to a category." },
            k: { type: "integer", description: "Max results (default 10)." },
          },
          required: [],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const sparse = typeof args.sparse === "string" && args.sparse.trim() ? args.sparse : undefined;
    const dense = typeof args.dense === "string" && args.dense.trim() ? args.dense : undefined;
    if (!sparse && !dense) return { ok: false, output: `SearchMemory rejected: provide "sparse" (regex) and/or "dense" (text).` };
    const scope = args.scope === "public" ? "shared" : args.scope === "private" ? "private" : undefined; // both → omit
    try {
      const res = await authedFetch("/kb/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sparse, dense, scope, category: args.category, k: args.k }),
      });
      // 503 → the encoder/OpenSearch is down; errText relays the API's clear message so the agent can tell the user.
      if (!res.ok) return { ok: false, output: `SearchMemory failed: ${await this.errText(res)}` };
      const { results, note } = (await res.json()) as { results: Hit[]; note?: string };
      if (!results.length) return { ok: true, output: note ? `${note}\n\nNo matching memories.` : "No matching memories." };
      const out = results
        .map((r) => `- [${r.id}] ${r.scope}${r.category ? `/${r.category}` : ""} (score ${r.score.toFixed(2)})\n    ${r.snippets.join("\n    ")}`)
        .join("\n");
      return { ok: true, output: note ? `${note}\n\n${out}` : out };
    } catch (e) {
      return { ok: false, output: `SearchMemory failed: ${errorMessage(e)}` };
    }
  }
}
