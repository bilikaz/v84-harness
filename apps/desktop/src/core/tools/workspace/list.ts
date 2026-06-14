import { readdir } from "node:fs/promises";

import { type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool, WORKSPACE_ROOT } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class List extends BaseWorkspaceTool {
  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "List",
        description:
          "List the entries of a directory in the workspace. Paths are under /workspace/ (the root), or relative. " +
          "Directories are suffixed with '/'. Defaults to /workspace when no path is given.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Directory, e.g. /workspace/src (default: /workspace)" } },
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? WORKSPACE_ROOT);
    try {
      const entries = await readdir(this.resolvePath(p, cwd), { withFileTypes: true });
      if (entries.length === 0) return { ok: true, output: `${p} is empty.` };
      const lines = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort((a, b) => a.localeCompare(b));
      return { ok: true, output: this.cap(`# ${p}\n${lines.join("\n")}`) };
    } catch (e) {
      return { ok: false, output: `error listing ${p}: ${errorMessage(e)}` };
    }
  }
}
