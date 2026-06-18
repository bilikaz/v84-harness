import { readFile } from "node:fs/promises";

import { OUTPUT_CAP } from "../base.ts";
import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Grep — recursive content search in pure Node (no `grep` binary, so identical on Windows/Mac/Linux).
// Read-only and argv-controlled (not a free-form shell), so it stays auto-run rather than going through a gate.
export class Grep extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Grep",
        description:
          "Search file contents in the workspace (recursive, line-numbered). Paths in results are " +
          "shown under /workspace/. The pattern is a JavaScript regular expression (plain text also works). " +
          "Use this to find where something is defined or used.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pattern: { type: "string", description: "The regular expression (or plain text) to search for." },
            path: { type: "string", description: "Directory to search, e.g. /workspace/src (default: the whole workspace)." },
            ignore_case: { type: "boolean", description: "Case-insensitive search. Default false." },
          },
          required: ["pattern"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return { ok: false, output: `Grep rejected: missing required "pattern".` };
    let re: RegExp;
    try {
      re = new RegExp(pattern, args.ignore_case ? "i" : "");
    } catch (e) {
      return { ok: false, output: `Grep rejected: invalid regular expression — ${errorMessage(e)}` };
    }
    const root = this.getRoot(cwd);
    const target = args.path ? this.resolvePath(String(args.path), cwd) : root;

    const lines: string[] = [];
    let total = 0;
    for await (const file of this.walk(target)) {
      if (signal?.aborted) return { ok: false, output: "[cancelled]" };
      let buf: Buffer;
      try {
        buf = await readFile(file);
      } catch {
        continue; // unreadable file — skip, like grep would
      }
      if (buf.includes(0)) continue; // binary file (NUL byte) — the old `-I`
      const rel = this.toWorkspacePath(file, root);
      const text = buf.toString("utf-8");
      let lineNo = 0;
      for (const line of text.split("\n")) {
        lineNo++;
        re.lastIndex = 0;
        if (re.test(line)) {
          lines.push(`${rel}:${lineNo}:${line}`);
          total += lines[lines.length - 1]!.length + 1;
        }
      }
      if (total >= OUTPUT_CAP) break; // already past what the model will see — stop walking
    }

    if (lines.length === 0) return { ok: true, output: "(no matches)" };
    return { ok: true, output: this.cap(lines.join("\n")) };
  }
}
