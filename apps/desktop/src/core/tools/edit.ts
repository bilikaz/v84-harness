import { readFile, writeFile } from "node:fs/promises";

import { type Tool } from "./types.ts";
import { toReal } from "./paths.ts";
import { errorMessage } from "../../lib/errors.ts";

// Exact string-replace in a file. `old_string` must be unique unless
// `replace_all` is set — mirrors the Claude-Code Edit contract.
export const editTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Edit",
      description:
        "Replace an exact string in a workspace file. `old_string` must appear exactly once unless " +
        "`replace_all` is true. Paths are workspace-relative ('/'). Read the file first to copy the exact text.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Workspace-relative path." },
          old_string: { type: "string", description: "The exact text to replace." },
          new_string: { type: "string", description: "The replacement text." },
          replace_all: { type: "boolean", description: "Replace every occurrence. Default false." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  async execute(args, ctx) {
    const p = String(args.path ?? "");
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    if (!p || !oldStr) return { ok: false, output: `Edit rejected: "path" and "old_string" are required.` };
    try {
      const real = toReal(ctx.cwd, p);
      const content = await readFile(real, "utf-8");
      const count = content.split(oldStr).length - 1;
      if (count === 0) return { ok: false, output: `Edit failed: old_string not found in ${p}.` };
      if (count > 1 && !args.replace_all) {
        return { ok: false, output: `Edit failed: old_string appears ${count}× in ${p}. Add more context to make it unique, or set replace_all.` };
      }
      const updated = args.replace_all ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
      await writeFile(real, updated, "utf-8");
      return { ok: true, output: `edited ${p} (${count} replacement${count === 1 ? "" : "s"})` };
    } catch (e) {
      return { ok: false, output: `error editing ${p}: ${errorMessage(e)}` };
    }
  },
};
