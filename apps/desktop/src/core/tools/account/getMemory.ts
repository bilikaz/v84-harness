import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseAccountTool } from "./base.ts";
import { authedFetch } from "../../account.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class GetMemory extends BaseAccountTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "GetMemory",
        description: "Fetch a memory's full text by its record id (from SearchMemory).",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { id: { type: "string", description: "The record id." } },
          required: ["id"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const id = String(args.id ?? "");
    if (!id) return { ok: false, output: `GetMemory rejected: missing required "id".` };
    try {
      const res = await authedFetch(`/kb/${encodeURIComponent(id)}`);
      if (res.status === 404) return { ok: false, output: `GetMemory: no memory ${id} (or not visible to you).` };
      if (!res.ok) return { ok: false, output: `GetMemory failed: ${await this.errText(res)}` };
      const r = (await res.json()) as { scope: string; category: string | null; content: string; status: string };
      const header = `${r.scope}${r.category ? `/${r.category}` : ""}${r.status !== "ready" ? ` (${r.status})` : ""}`;
      return { ok: true, output: `[${id}] ${header}\n\n${r.content}` };
    } catch (e) {
      return { ok: false, output: `GetMemory failed: ${errorMessage(e)}` };
    }
  }
}
