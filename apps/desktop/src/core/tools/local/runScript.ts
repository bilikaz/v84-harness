import { spawn } from "node:child_process";

import { type ToolResult, type ToolSpec, type ToolPermission } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";

// RunScript — execute a JavaScript file from the workspace in a REAL, SEPARATE Node process (never eval'd
// into the harness: a runaway/crashing script kills the child, not the app, and can't reach in-process state).
// Node ships with the app (Electron's runtime, via ELECTRON_RUN_AS_NODE), so this is portable with no host install.
// Developer-only: canRun() gates on config.app.developerMode, so it isn't even advertised to regular users.
export class RunScript extends BaseWorkspaceTool {
  override canRun(): boolean {
    return this.config().app.developerMode === true;
  }

  override defaultPermission(): ToolPermission {
    return 1; // arbitrary code — ask by default
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "RunScript",
        description:
          "Run a JavaScript file from the workspace with Node and return its combined stdout+stderr and exit code. " +
          "Write the script first (with Write), then run it by path. The script runs in its own process; state " +
          "does not persist between calls.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "The .js/.mjs file to run, e.g. /workspace/scripts/report.js" },
            args: { type: "array", items: { type: "string" }, description: "Optional arguments passed to the script." },
            timeout_seconds: { type: "number", description: "Optional. Default 60." },
          },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `RunScript rejected: missing required "path".` };
    let scriptPath: string;
    try {
      scriptPath = this.resolvePath(p, cwd);
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) };
    }
    const extra = Array.isArray(args.args) ? args.args.map(String) : [];
    const timeoutMs = typeof args.timeout_seconds === "number" ? args.timeout_seconds * 1000 : 60_000;
    return this.exec([scriptPath, ...extra], cwd, timeoutMs, signal);
  }

  private exec(argv: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return Promise.resolve({ ok: false, output: "[cancelled before start]" });
    return new Promise((resolve) => {
      // process.execPath is the app's bundled Node (the Electron binary run as Node via ELECTRON_RUN_AS_NODE).
      const proc = spawn(process.execPath, argv, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      let out = "";
      let timedOut = false;
      let cancelled = false;
      const onAbort = (): void => {
        cancelled = true;
        proc.kill("SIGKILL");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeoutMs);
      proc.stdout.on("data", (b: Buffer) => (out += b.toString("utf-8")));
      proc.stderr.on("data", (b: Buffer) => (out += b.toString("utf-8")));
      proc.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const suffix = cancelled
          ? `\n[exit: cancelled by the user]`
          : timedOut
            ? `\n[exit: killed after ${timeoutMs}ms timeout]`
            : `\n[exit: ${code}]`;
        resolve({ ok: !timedOut && !cancelled && code === 0, output: this.hideRoot(cwd, this.cap(out)) + suffix });
      });
      proc.on("error", (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, output: `error running script: ${e.message}` });
      });
    });
  }
}
