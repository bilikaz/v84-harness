import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class Write extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Write",
        description:
          "Create or overwrite a file in the workspace. Paths are under /workspace/ (the root), or relative. Parent " +
          "directories are created automatically. Overwrites existing files — read first if unsure.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path, e.g. /workspace/src/new.ts" },
            content: { type: "string", description: "The full file content to write." },
          },
          required: ["path", "content"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Write rejected: missing required "path".` };
    if (typeof args.content !== "string") return { ok: false, output: `Write rejected: "content" must be a string.` };
    try {
      const real = this.resolvePath(p, cwd);
      await mkdir(path.dirname(real), { recursive: true });
      await writeFile(real, args.content, "utf-8");
      return { ok: true, output: `wrote ${p} (${args.content.length} bytes)` };
    } catch (e) {
      return { ok: false, output: `error writing ${p}: ${errorMessage(e)}` };
    }
  }
}
