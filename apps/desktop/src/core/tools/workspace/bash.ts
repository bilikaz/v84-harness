import { spawn } from "node:child_process";

import { type ToolResult, type ToolSchema, type ToolPermission } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";

// Bash (gated — a shell can't be path-confined): expands the /workspace marker to the real root, scrubs the real root back to /workspace in output so no host path leaks.
export class Bash extends BaseWorkspaceTool {
  override defaultPermission(): ToolPermission {
    return 1; // a shell asks by default
  }

  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "Bash",
        description:
          "Run a shell command in the workspace. cwd is the workspace root (/workspace); use relative paths (e.g. " +
          "`cat package.json`) or /workspace-absolute paths (e.g. `ls /workspace/src`). " +
          "Returns combined stdout+stderr and the exit code. Use for git, build/test, sed/awk, etc. " +
          "State does not persist between calls.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            command: { type: "string", description: "The shell command to run." },
            timeout_seconds: { type: "number", description: "Optional. Default 60." },
          },
          required: ["command"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    const command = String(args.command ?? "");
    if (!command) return { ok: false, output: `Bash rejected: missing required "command". Example: {"command":"ls -la"}` };
    const timeoutMs = typeof args.timeout_seconds === "number" ? args.timeout_seconds * 1000 : 60_000;
    return this.exec(this.expandWorkspace(command, cwd), cwd, timeoutMs, signal);
  }

  private exec(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return Promise.resolve({ ok: false, output: "[cancelled before start]" });
    return new Promise((resolve) => {
      const proc = spawn("bash", ["-lc", command], { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
        resolve({ ok: !timedOut && !cancelled && code === 0, output: this.hideRoot(this.cap(out), cwd) + suffix });
      });
      proc.on("error", (e) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ ok: false, output: `error spawning bash: ${e.message}` });
      });
    });
  }
}
