// Shared types + helpers for the agent tools that run in the Electron main
// process. Mirrors the reviewer's tools/shared.ts (/var/tools/reviewer), adapted
// so each tool receives a per-call `ToolCtx` (the session's workspace root)
// instead of relying on a single process cwd.

// The tool DOMAIN types live here — core owns them. The Electron bridge
// (src/bridge.ts) and the renderer import these; never the reverse.

// OpenAI function-tool schema shape advertised to the model.
export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

// A tool call the model produced — normalized flat shape.
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string; // raw JSON string, as the model emitted it
}

// What a tool returns; `output` is the string fed back to the model.
export interface ToolResult {
  ok: boolean;
  output: string;
}

// Per-call context handed to every tool. `cwd` is the session's workspace root.
//
// VIRTUAL ROOT — the model never sees real host paths. The workspace root IS
// "/" from the model's point of view. So fs tools (Read/List/Grep/Write/Edit/
// CreateFolder):
//   - interpret every incoming path as workspace-relative — a leading "/" means
//     the workspace root, NOT the host root (so "/etc/passwd" maps under the
//     workspace and can never reach the host's /etc).
//   - real = resolve(cwd, virtual.replace(/^\/+/, "")), then REJECT if the
//     result escapes cwd (the hard confinement rule — `..` / symlinks included).
//   - rewrite any path in OUTPUT back to virtual (strip the cwd prefix → "/…"),
//     e.g. Grep/List results, so nothing real ever leaks to the model.
// Bash is the exception: a real shell run with cwd = the workspace root, so it
// sees real relative paths and can't be virtualized — which is exactly why it's
// the gated tool.
export interface ToolCtx {
  cwd: string;
}

// Each tool exposes its own schema and an execute method. The dispatcher in
// index.ts collects them and routes a call by schema.function.name.
export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

// The tool vocabulary — the canonical names + the per-workspace permission
// model. A workspace stores a `ToolMode` per tool (see core/workspaces.ts):
//   0 = disabled  (withheld from the advertised schemas)
//   1 = enabled   (available, but each call asks for approval)
//   2 = auto      (available, runs without a prompt)
export type ToolName = "Read" | "List" | "Grep" | "Write" | "Edit" | "CreateFolder" | "Bash";
export type ToolMode = 0 | 1 | 2;

export const ALL_TOOLS: readonly ToolName[] = ["Read", "List", "Grep", "Write", "Edit", "CreateFolder", "Bash"];

// Defaults: read + path-confined writes auto-run (confinement is the safety);
// Bash is the only gated tool by default since a shell escapes confinement.
export const DEFAULT_TOOL_POLICY: Record<ToolName, ToolMode> = {
  Read: 2,
  List: 2,
  Grep: 2,
  Write: 2,
  Edit: 2,
  CreateFolder: 2,
  Bash: 1,
};

// 64 KB per tool result is plenty; truncate beyond so a runaway command can't
// blow up the model's context.
export const OUTPUT_CAP = 64 * 1024;

export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}
