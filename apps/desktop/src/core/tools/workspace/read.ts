import { readFile } from "node:fs/promises";

import { type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

const MAX_LINES = 300;

export class Read extends BaseWorkspaceTool {
  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "Read",
        description:
          "Read a file from the workspace. Paths are under /workspace/ (the workspace root), or relative. " +
          "Returns up to the first 300 lines, each prefixed with its line number, plus a header with the " +
          "visible range and total. For longer files, use Bash `sed -n 'START,ENDp' path` to fetch more.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Path, e.g. /workspace/src/foo.ts" } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Read rejected: missing required "path". Example: {"path":"/workspace/src/foo.ts"}` };
    try {
      const content = await readFile(this.resolve(p), "utf-8");
      return { ok: true, output: this.cap(format(p, content)) };
    } catch (e) {
      return { ok: false, output: `error reading ${p}: ${errorMessage(e)}. Try List or Bash to check the path.` };
    }
  }
}

function format(p: string, content: string): string {
  const lines = content.split(/\r?\n/);
  const total = lines.length;
  const visible = lines.slice(0, MAX_LINES);
  const width = String(visible.length).length;
  const numbered = visible.map((l, i) => `${String(i + 1).padStart(width, " ")}: ${l}`).join("\n");
  const header = `# ${p} (lines 1-${visible.length} of ${total})`;
  if (total <= MAX_LINES) return `${header}\n${numbered}`;
  const nextStart = MAX_LINES + 1;
  const nextEnd = Math.min(total, MAX_LINES * 2);
  return [header, numbered, ``, `[... ${total - MAX_LINES} more lines]`, `# Next: Bash {"command": "sed -n '${nextStart},${nextEnd}p' ${p}"}`].join("\n");
}
