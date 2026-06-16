import { readFile, writeFile } from "node:fs/promises";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class Edit extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Edit",
        description:
          "Replace an exact string in a workspace file. `old_string` must appear exactly once unless " +
          "`replace_all` is true. Paths are under /workspace/ (the root), or relative. Read the file first to copy the exact text.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path, e.g. /workspace/src/foo.ts" },
            old_string: { type: "string", description: "The exact text to replace." },
            new_string: { type: "string", description: "The replacement text." },
            replace_all: { type: "boolean", description: "Replace every occurrence. Default false." },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    if (!p || !oldStr) return { ok: false, output: `Edit rejected: "path" and "old_string" are required.` };
    try {
      const real = this.resolvePath(p, cwd);
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
  }
}
