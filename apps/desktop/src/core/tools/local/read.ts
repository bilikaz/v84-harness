import { readFile } from "node:fs/promises";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

const MAX_LINES = 300;

export class Read extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Read",
        description:
          "Read a file from the workspace. Paths are under /workspace/ (the workspace root), or relative. " +
          "Returns up to 300 lines from `offset` (default line 1), each prefixed with its line number, plus a " +
          "header with the visible range and total. For longer files, call again with `offset` at the next line.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path, e.g. /workspace/src/foo.ts" },
            offset: { type: "number", description: "1-based line to start from (default 1). Use to page through long files." },
          },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Read rejected: missing required "path". Example: {"path":"/workspace/src/foo.ts"}` };
    const offset = typeof args.offset === "number" && args.offset >= 1 ? Math.floor(args.offset) : 1;
    try {
      const content = await readFile(this.resolvePath(p, cwd), "utf-8");
      return { ok: true, output: this.cap(format(p, content, offset)) };
    } catch (e) {
      return { ok: false, output: `error reading ${p}: ${errorMessage(e)}. Try List to check the path.` };
    }
  }
}

function format(p: string, content: string, offset: number): string {
  const lines = content.split(/\r?\n/);
  const total = lines.length;
  const start = Math.min(offset, total + 1); // past EOF → empty slice, honest header
  const visible = lines.slice(start - 1, start - 1 + MAX_LINES);
  const end = start - 1 + visible.length;
  const width = String(end).length;
  const numbered = visible.map((l, i) => `${String(start + i).padStart(width, " ")}: ${l}`).join("\n");
  const header = `# ${p} (lines ${start}-${end} of ${total})`;
  if (end >= total) return `${header}\n${numbered}`;
  const nextStart = end + 1;
  return [header, numbered, ``, `[... ${total - end} more lines]`, `# Next: Read {"path": "${p}", "offset": ${nextStart}}`].join("\n");
}
