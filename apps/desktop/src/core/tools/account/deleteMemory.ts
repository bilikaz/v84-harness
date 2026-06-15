import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseAccountTool } from "./base.ts";
import { authedFetch } from "../../account.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class DeleteMemory extends BaseAccountTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "DeleteMemory",
        description: "Delete a memory by record id (your own memories only).",
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
    if (!id) return { ok: false, output: `DeleteMemory rejected: missing required "id".` };
    try {
      const res = await authedFetch(`/kb/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 404) return { ok: false, output: `DeleteMemory: no memory ${id} you can delete.` };
      if (!res.ok) return { ok: false, output: `DeleteMemory failed: ${await this.errText(res)}` };
      return { ok: true, output: `Deleted memory ${id}.` };
    } catch (e) {
      return { ok: false, output: `DeleteMemory failed: ${errorMessage(e)}` };
    }
  }
}
