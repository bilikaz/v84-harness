import { readFile } from "node:fs/promises";

import { type Tool } from "./types.ts";
import { cap } from "./shared.ts";
import { toReal } from "./paths.ts";
import { errorMessage } from "../../lib/errors.ts";

const MAX_LINES = 300;

export const readTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Read",
      description:
        "Read a file from the workspace. Paths are relative to the workspace root, which is shown as '/'. " +
        "Returns up to the first 300 lines, each prefixed with its line number, plus a header with the " +
        "visible range and total. For longer files, use Bash `sed -n 'START,ENDp' path` to fetch more.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string", description: "Workspace-relative path, e.g. /src/foo.ts" } },
        required: ["path"],
      },
    },
  },
  async execute(args, ctx) {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `Read rejected: missing required "path". Example: {"path":"/src/foo.ts"}` };
    try {
      const content = await readFile(toReal(ctx.cwd, p), "utf-8");
      return { ok: true, output: cap(format(p, content)) };
    } catch (e) {
      return { ok: false, output: `error reading ${p}: ${errorMessage(e)}. Try List or Bash to check the path.` };
    }
  },
};

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
  return [header, numbered, ``, `[... ${total - MAX_LINES} more lines]`, `# Next: Bash {"command": "sed -n '${nextStart},${nextEnd}p' ${p.replace(/^\//, "")}"}`].join("\n");
}
