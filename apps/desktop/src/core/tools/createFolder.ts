import { mkdir } from "node:fs/promises";

import { type Tool } from "./types.ts";
import { toReal } from "./paths.ts";
import { errorMessage } from "../../lib/errors.ts";

// Create a directory (recursive). Confined to the workspace.
export const createFolderTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "CreateFolder",
      description: "Create a directory in the workspace (and any missing parents). Paths are workspace-relative ('/').",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string", description: "Workspace-relative directory to create, e.g. /src/utils" } },
        required: ["path"],
      },
    },
  },
  async execute(args, ctx) {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `CreateFolder rejected: missing required "path".` };
    try {
      await mkdir(toReal(ctx.cwd, p), { recursive: true });
      return { ok: true, output: `created ${p}` };
    } catch (e) {
      return { ok: false, output: `error creating ${p}: ${errorMessage(e)}` };
    }
  },
};
