import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { BaseTool } from "../base.ts";

// Virtual-root path mapping + confinement (ADR-0007): the model sees "/workspace" as the root; paths outside it are refused.
// The pure functions stay exported (unit-tested directly); BaseWorkspaceTool wraps them as per-call methods.

// The virtual workspace root the model sees; real host paths never cross the tool boundary.
export const WORKSPACE_ROOT = "/workspace";

/*
// Virtual path → workspace-relative. Relative input passes through; "/workspace[/…]" → the part under it;
// a leading-slash path not under /workspace returns null (the caller refuses it as outside the workspace).


// In a shell command, expand the "/workspace" marker to the real root — only this distinctive token at word
// starts, so regexes, URLs, sed scripts, and flag values keep their own slashes.
*/

// Workspace file tools: confined path resolution against the session's cwd; subject to the workspace policy.
export abstract class BaseWorkspaceTool extends BaseTool {
  override isPermissioned(): boolean {
    return true;
  }

  protected getRoot(cwd: string): string {
    return realpathSync(path.resolve(cwd));
  }

  protected hideRoot(cwd: string, out: string): string {
    return out.split(cwd + "/").join(`${WORKSPACE_ROOT}/`).split(cwd).join(WORKSPACE_ROOT);
  }

  private underWorkspace(virtual: string): string | null {
    if (!/^[/\\]/.test(virtual)) return virtual;
    const rel = virtual.replace(/^[/\\]+workspace(?=[/\\]|$)/, "");
    return rel === virtual ? null : rel.replace(/^[/\\]+/, "");
  }

  protected expandWorkspace(command: string, cwd: string): string {
    return command.replace(/(^|[\s"'(=])\/workspace(?=\/|[\s"';:)&|<>]|$)/g, (_m, pre: string) => `${pre}${cwd}`);
  }

  protected resolvePath(virtual: string, cwd: string): string {
    const root = this.getRoot(cwd);
    const rel = this.underWorkspace(String(virtual));
    if (rel === null) throw new Error(`path "${virtual}" is outside the workspace — use /workspace/… or a relative path`);
    const real = path.resolve(root, rel);

    const inside = (p: string) => p === root || p.startsWith(root + path.sep);
    if (!inside(real)) throw new Error(`path "${virtual}" escapes the workspace root`);

    // Resolve symlinks on the deepest existing ancestor and re-check, so an in-workspace symlink can't redirect outside.
    let probe = real;
    while (probe !== path.dirname(probe) && !existsSync(probe)) probe = path.dirname(probe);
    const resolved = existsSync(probe) ? realpathSync(probe) : probe;
    if (!inside(resolved)) throw new Error(`path "${virtual}" resolves (via symlink) outside the workspace root`);

    return real;
  }
}
