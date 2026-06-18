import { mkdir, rename } from "node:fs/promises";
import path from "node:path";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Move/rename a file or folder within the workspace (fs.rename — pure Node, portable). Parent dirs of the
// destination are created. Both ends are confined to /workspace.
export class Move extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Move",
        description:
          "Move or rename a file or folder within the workspace. Paths are under /workspace/ (the root), or relative. " +
          "Missing parent directories of the destination are created.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", description: "Existing path, e.g. /workspace/draft.md" },
            to: { type: "string", description: "Destination path, e.g. /workspace/docs/final.md" },
          },
          required: ["from", "to"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!from || !to) return { ok: false, output: `Move rejected: both "from" and "to" are required.` };
    try {
      const dest = this.resolvePath(to, cwd);
      await mkdir(path.dirname(dest), { recursive: true });
      await rename(this.resolvePath(from, cwd), dest);
      return { ok: true, output: `moved ${from} -> ${to}` };
    } catch (e) {
      return { ok: false, output: `error moving ${from} -> ${to}: ${errorMessage(e)}` };
    }
  }
}
