import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Tool } from "./types.ts";
import { toReal } from "./paths.ts";
import { errorMessage } from "../../lib/errors.ts";

// Create or overwrite a file. Confined to the workspace (path can't escape), so
// it auto-runs by default. Creates parent directories as needed.
export const writeTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Write",
      description:
        "Create or overwrite a file in the workspace. Paths are workspace-relative ('/'). Parent " +
        "directories are created automatically. Overwrites existing files — read first if unsure.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Workspace-relative path, e.g. /src/new.ts" },
          content: { type: "string", description: "The full file content to write." },
        },
        required: ["path", "content"],
      },
    },
  },
  async execute(args, ctx) {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Write rejected: missing required "path".` };
    if (typeof args.content !== "string") return { ok: false, output: `Write rejected: "content" must be a string.` };
    try {
      const real = toReal(ctx.cwd, p);
      await mkdir(path.dirname(real), { recursive: true });
      await writeFile(real, args.content, "utf-8");
      return { ok: true, output: `wrote ${p} (${args.content.length} bytes)` };
    } catch (e) {
      return { ok: false, output: `error writing ${p}: ${errorMessage(e)}` };
    }
  },
};
