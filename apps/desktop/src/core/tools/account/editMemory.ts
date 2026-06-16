import { type ToolResult, type ToolSpec, type ToolPermission } from "../types.ts";
import { BaseAccountTool } from "./base.ts";
import { authedFetch } from "../../account.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class EditMemory extends BaseAccountTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "EditMemory",
        description: "Replace a memory's text by record id (your own memories only). It is re-chunked + re-embedded in the background.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", description: "The record id." },
            content: { type: "string", description: "The new full text." },
          },
          required: ["id", "content"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const id = String(args.id ?? "");
    const content = String(args.content ?? "");
    if (!id || !content) return { ok: false, output: `EditMemory rejected: "id" and "content" required.` };
    try {
      const res = await authedFetch(`/kb/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.status === 404) return { ok: false, output: `EditMemory: no memory ${id} you can edit.` };
      if (!res.ok) return { ok: false, output: `EditMemory failed: ${await this.errText(res)}` };
      return { ok: true, output: `Updated memory ${id}; re-indexing in the background.` };
    } catch (e) {
      return { ok: false, output: `EditMemory failed: ${errorMessage(e)}` };
    }
  }

  isPermissioned(): boolean {
    return true;
  }

  defaultPermission(): ToolPermission {
    return 1;
  }
}
