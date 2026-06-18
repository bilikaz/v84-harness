import { rm } from "node:fs/promises";

import { type ToolResult, type ToolSpec, type ToolPermission } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Delete a file or folder within the workspace (fs.rm, recursive — pure Node, portable). The one destructive
// file op, so it defaults to ask. Refuses to delete the workspace root itself.
export class Delete extends BaseWorkspaceTool {
  override defaultPermission(): ToolPermission {
    return 1; // destructive — ask by default
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Delete",
        description:
          "Delete a file or folder within the workspace (folders delete recursively). Paths are under " +
          "/workspace/ (the root), or relative. This cannot be undone.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Path to delete, e.g. /workspace/old/notes.txt" } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Delete rejected: missing required "path".` };
    try {
      const real = this.resolvePath(p, cwd);
      if (real === this.getRoot(cwd)) return { ok: false, output: `Delete rejected: cannot delete the workspace root.` };
      await rm(real, { recursive: true, force: false });
      return { ok: true, output: `deleted ${p}` };
    } catch (e) {
      return { ok: false, output: `error deleting ${p}: ${errorMessage(e)}` };
    }
  }
}
