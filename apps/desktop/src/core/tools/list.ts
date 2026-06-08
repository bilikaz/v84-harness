import { readdir } from "node:fs/promises";

import { cap, type Tool } from "./shared.ts";
import { toReal } from "./paths.ts";

// List a directory's entries. Directories get a trailing "/". Paths stay
// workspace-relative; "/" is the workspace root.
export const listTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "List",
      description:
        "List the entries of a directory in the workspace. Paths are relative to the workspace root ('/'). " +
        "Directories are suffixed with '/'. Defaults to the workspace root when no path is given.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string", description: "Workspace-relative directory, e.g. /src (default: /)" } },
      },
    },
  },
  async execute(args, ctx) {
    const p = String(args.path ?? "/");
    try {
      const entries = await readdir(toReal(ctx.cwd, p), { withFileTypes: true });
      if (entries.length === 0) return { ok: true, output: `${p} is empty.` };
      const lines = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => a.localeCompare(b));
      return { ok: true, output: cap(`# ${p}\n${lines.join("\n")}`) };
    } catch (e) {
      return { ok: false, output: `error listing ${p}: ${(e as Error).message}` };
    }
  },
};
