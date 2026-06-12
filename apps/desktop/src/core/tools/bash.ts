import { spawn } from "node:child_process";
import path from "node:path";

import { type Tool, type ToolResult } from "./types.ts";
import { cap } from "./shared.ts";
import { rootReal } from "./paths.ts";

// Bash (gated — a shell can't be path-confined): rewrites workspace-absolute "/" paths to real ones before running, and scrubs the real root back to "/" in output so no host path leaks.
export const bashTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "Bash",
      description:
        "Run a shell command in the workspace. cwd is the workspace root; use relative paths (e.g. " +
        "`cat package.json`) or workspace-absolute paths ('/' = the workspace root, e.g. `ls /src`). " +
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
  },
  async execute(args, ctx) {
    const command = String(args.command ?? "");
    if (!command) return { ok: false, output: `Bash rejected: missing required "command". Example: {"command":"ls -la"}` };
    const timeoutMs = typeof args.timeout_seconds === "number" ? args.timeout_seconds * 1000 : 60_000;
    const root = rootReal(ctx.cwd);
    return run(mapVirtualPaths(command, root), root, timeoutMs, ctx.signal);
  },
};

// Rewrite "/x" → "<root>/x" only at shell word starts, so `sed s/a/b/`, `http://…`, and other embedded slashes are untouched.
function mapVirtualPaths(command: string, root: string): string {
  return command.replace(/(^|[\s"'(=])\/(\S*)/g, (_m, pre: string, rest: string) => `${pre}${root}/${rest}`);
}

// Map the real root back to "/" in output; "<root>/" must be replaced before a bare "<root>".
function scrub(out: string, root: string): string {
  return out.split(root + path.sep).join("/").split(root).join("/");
}

function run(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
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
      resolve({ ok: !timedOut && !cancelled && code === 0, output: scrub(cap(out), cwd) + suffix });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, output: `error spawning bash: ${e.message}` });
    });
  });
}
