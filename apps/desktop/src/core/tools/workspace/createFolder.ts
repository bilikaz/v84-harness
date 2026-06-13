import { mkdir } from "node:fs/promises";

import { type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class CreateFolder extends BaseWorkspaceTool {
  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "CreateFolder",
        description: "Create a directory in the workspace (and any missing parents). Paths are under /workspace/ (the root), or relative.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Directory to create, e.g. /workspace/src/utils" } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `CreateFolder rejected: missing required "path".` };
    try {
      await mkdir(this.resolve(p), { recursive: true });
      return { ok: true, output: `created ${p}` };
    } catch (e) {
      return { ok: false, output: `error creating ${p}: ${errorMessage(e)}` };
    }
  }
}
