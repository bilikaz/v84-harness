import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseAccountTool } from "./base.ts";
import { authedFetch } from "../../account.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class SaveMemory extends BaseAccountTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "SaveMemory",
        description:
          "Save a memory to the knowledgebase for later recall. scope 'private' = only you; 'public' = shared company-wide. " +
          "Returns a record id; the text is chunked + embedded in the background.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string", description: "The text to remember." },
            scope: { type: "string", enum: ["private", "public"], description: "private = only you; public = shared with everyone." },
            category: { type: "string", description: "Optional category label (public memories)." },
          },
          required: ["content", "scope"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const content = String(args.content ?? "");
    if (!content) return { ok: false, output: `SaveMemory rejected: missing required "content".` };
    const scope = args.scope === "public" ? "shared" : "private";
    const category = typeof args.category === "string" && args.category.trim() ? args.category.trim() : undefined;
    try {
      const res = await authedFetch("/kb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, scope, category }),
      });
      if (!res.ok) return { ok: false, output: `SaveMemory failed: ${await this.errText(res)}` };
      const { id } = (await res.json()) as { id: string };
      return { ok: true, output: `Saved ${args.scope} memory (id ${id}); indexing in the background.` };
    } catch (e) {
      return { ok: false, output: `SaveMemory failed: ${errorMessage(e)}` };
    }
  }
}
