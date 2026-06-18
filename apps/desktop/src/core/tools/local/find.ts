import path from "node:path";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";

// Find — locate files by NAME (Grep searches contents). Glob with `*` (any run) and `?` (one char),
// matched against the file's base name, case-insensitively: `*report*`, `report*`, `*.docx`, exact.
export class Find extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Find",
        description:
          "Find files by name in the workspace (recursive). The pattern is a name glob matched against each " +
          "file's name, case-insensitive: `*` matches any run of characters, `?` one character. So `*report*` " +
          "(contains), `report*` / `*.docx` (prefix/suffix), or an exact name all work. Results are listed under /workspace/.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pattern: { type: "string", description: "Name glob, e.g. *.docx, report*, *budget*" },
            path: { type: "string", description: "Directory to search under, e.g. /workspace/src (default: the whole workspace)." },
          },
          required: ["pattern"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return { ok: false, output: `Find rejected: missing required "pattern".` };
    const root = this.getRoot(cwd);
    const target = args.path ? this.resolvePath(String(args.path), cwd) : root;
    const re = globToRegExp(pattern);

    const hits: string[] = [];
    for await (const file of this.walk(target)) {
      if (signal?.aborted) return { ok: false, output: "[cancelled]" };
      if (re.test(path.basename(file))) hits.push(this.toWorkspacePath(file, root));
    }
    if (hits.length === 0) return { ok: true, output: "(no matches)" };
    hits.sort((a, b) => a.localeCompare(b));
    return { ok: true, output: this.cap(hits.join("\n")) };
  }
}

// A name glob → anchored, case-insensitive RegExp. Only `*` and `?` are wildcards; every other regex
// metacharacter is escaped so a literal name (e.g. `a.b`) matches itself, not "a<any>b".
function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "*" ? ".*" : c === "?" ? "." : `\\${c}`));
  return new RegExp(`^${body}$`, "i");
}
