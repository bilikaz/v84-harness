import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Copy a file or folder within the workspace (fs.cp, recursive — pure Node, portable). Parent dirs of the
// destination are created. Both ends are confined to /workspace.
export class Copy extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Copy",
        description:
          "Copy a file or folder within the workspace (folders copy recursively). Paths are under /workspace/ " +
          "(the root), or relative. Missing parent directories of the destination are created.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", description: "Existing path, e.g. /workspace/template.md" },
            to: { type: "string", description: "Destination path, e.g. /workspace/docs/copy.md" },
          },
          required: ["from", "to"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!from || !to) return { ok: false, output: `Copy rejected: both "from" and "to" are required.` };
    try {
      const dest = this.resolvePath(to, cwd);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(this.resolvePath(from, cwd), dest, { recursive: true });
      return { ok: true, output: `copied ${from} -> ${to}` };
    } catch (e) {
      return { ok: false, output: `error copying ${from} -> ${to}: ${errorMessage(e)}` };
    }
  }
}
