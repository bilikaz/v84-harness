import { spawn } from "node:child_process";

import { type Tool, type ToolResult } from "./types.ts";
import { cap } from "./shared.ts";
import { rootReal, toReal } from "./paths.ts";

const GREP_TIMEOUT_MS = 30_000;

// Search file contents with `grep -rIn`. Read-only and argv-controlled (not a
// free-form shell), so it stays auto-run rather than going through the Bash
// gate. Output paths are rewritten to workspace-relative ("/…").
export const grepTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Grep",
      description:
        "Search file contents in the workspace (recursive, line-numbered). Paths in results are " +
        "workspace-relative ('/'). Use this to find where something is defined or used.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          pattern: { type: "string", description: "The (basic) regex / text to search for." },
          path: { type: "string", description: "Workspace-relative dir to search (default: /)." },
          ignore_case: { type: "boolean", description: "Case-insensitive search. Default false." },
        },
        required: ["pattern"],
      },
    },
  },
  async execute(args, ctx) {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return { ok: false, output: `Grep rejected: missing required "pattern".` };
    const root = rootReal(ctx.cwd);
    // Confine the search target to the workspace; default to the whole root.
    const target = args.path ? toReal(ctx.cwd, String(args.path)) : root;
    const rel = target === root ? "." : target.slice(root.length + 1);
    const flags = ["-rIn", ...(args.ignore_case ? ["-i"] : [])];
    return run(["grep", ...flags, "--", pattern, rel], root, ctx.signal);
  },
};

function run(argv: string[], cwd: string, signal?: AbortSignal): Promise<ToolResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, output: "[cancelled before start]" });
  return new Promise((resolve) => {
    const proc = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    signal?.addEventListener("abort", () => proc.kill("SIGKILL"), { once: true });
    const timer = setTimeout(() => proc.kill("SIGKILL"), GREP_TIMEOUT_MS);
    proc.stdout.on("data", (b: Buffer) => (out += b.toString("utf-8")));
    proc.stderr.on("data", (b: Buffer) => (err += b.toString("utf-8")));
    proc.on("close", (code) => {
      clearTimeout(timer);
      // grep exits 1 for "no matches" — that's a successful empty result.
      if (code === 1 && !out) return resolve({ ok: true, output: "(no matches)" });
      if (code !== 0 && code !== 1) return resolve({ ok: false, output: err.trim() || `grep exited ${code}` });
      // Rewrite "./path" / "path" → workspace-relative "/path".
      const rewritten = out.replace(/^\.?\/?/gm, (m, off) => (off === 0 || out[off - 1] === "\n" ? "/" : m));
      resolve({ ok: true, output: cap(rewritten) });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `error running grep: ${e.message}` });
    });
  });
}
