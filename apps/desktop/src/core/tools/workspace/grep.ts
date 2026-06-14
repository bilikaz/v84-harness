import { spawn } from "node:child_process";

import { type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool, WORKSPACE_ROOT } from "./base.ts";

const GREP_TIMEOUT_MS = 30_000;

// Grep — read-only and argv-controlled (not a free-form shell), so it stays auto-run rather than going through the Bash gate.
export class Grep extends BaseWorkspaceTool {
  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "Grep",
        description:
          "Search file contents in the workspace (recursive, line-numbered). Paths in results are " +
          "shown under /workspace/. Use this to find where something is defined or used.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pattern: { type: "string", description: "The (basic) regex / text to search for." },
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
    const root = this.getRoot(cwd);
    const target = args.path ? this.resolvePath(String(args.path), cwd) : root;
    const rel = target === root ? "." : target.slice(root.length + 1);
    const flags = ["-rIn", ...(args.ignore_case ? ["-i"] : [])];
    return this.search(["grep", ...flags, "--", pattern, rel], root, signal);
  }

  private search(argv: string[], cwd: string, signal?: AbortSignal): Promise<ToolResult> {
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
        if (code === 1 && !out) return resolve({ ok: true, output: "(no matches)" });
        if (code !== 0 && code !== 1) return resolve({ ok: false, output: err.trim() || `grep exited ${code}` });
        const rewritten = out.replace(/^\.?\/?/gm, (m, off) => (off === 0 || out[off - 1] === "\n" ? `${WORKSPACE_ROOT}/` : m));
        resolve({ ok: true, output: this.cap(rewritten) });
      });
      proc.on("error", (e) => {
        clearTimeout(timer);
        resolve({ ok: false, output: `error running grep: ${e.message}` });
      });
    });
  }
}
