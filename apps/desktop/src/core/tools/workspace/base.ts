import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { BaseTool } from "../base.ts";

// Virtual-root path mapping + confinement (ADR-0007): the model sees "/workspace" as the root; paths outside it are refused.
// The pure functions stay exported (unit-tested directly); BaseWorkspaceTool wraps them as per-call methods.

// The virtual workspace root the model sees; real host paths never cross the tool boundary.
export const WORKSPACE_ROOT = "/workspace";

export function rootReal(cwd: string): string {
  return realpathSync(path.resolve(cwd));
}

// Virtual path → workspace-relative. Relative input passes through; "/workspace[/…]" → the part under it;
// a leading-slash path not under /workspace returns null (the caller refuses it as outside the workspace).
export function underWorkspace(virtual: string): string | null {
  if (!/^[/\\]/.test(virtual)) return virtual;
  const rel = virtual.replace(/^[/\\]+workspace(?=[/\\]|$)/, "");
  return rel === virtual ? null : rel.replace(/^[/\\]+/, "");
}

export function toReal(cwd: string, virtual: string): string {
  const root = rootReal(cwd);
  const rel = underWorkspace(String(virtual));
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

// In a shell command, expand the "/workspace" marker to the real root — only this distinctive token at word
// starts, so regexes, URLs, sed scripts, and flag values keep their own slashes.
export function expandWorkspace(command: string, root: string): string {
  return command.replace(/(^|[\s"'(=])\/workspace(?=\/|[\s"';:)&|<>]|$)/g, (_m, pre: string) => `${pre}${root}`);
}

// In tool output, hide the real root behind the marker so no host path leaks (root + "/" before bare root).
export function hideRoot(out: string, root: string): string {
  return out.split(root + "/").join(`${WORKSPACE_ROOT}/`).split(root).join(WORKSPACE_ROOT);
}

// Workspace file tools: confined path resolution against the session's cwd.
export abstract class BaseWorkspaceTool extends BaseTool {
  protected get root(): string {
    return rootReal(this.cwd);
  }
  protected resolve(virtual: string): string {
    return toReal(this.cwd, virtual);
  }
}
