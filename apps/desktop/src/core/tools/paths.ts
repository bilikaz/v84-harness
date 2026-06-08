import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// Virtual-root path mapping + confinement (see ToolCtx in shared.ts). The model
// addresses files relative to the workspace root, which it sees as "/". We map
// to a real host path under cwd and REJECT anything that escapes — `..`,
// absolutes (a leading "/" just means the workspace root), and symlinks that
// point outside.

export function rootReal(cwd: string): string {
  return realpathSync(path.resolve(cwd));
}

export function toReal(cwd: string, virtual: string): string {
  const root = rootReal(cwd);
  const rel = String(virtual).replace(/^[/\\]+/, ""); // leading "/" = workspace root, not host root
  const real = path.resolve(root, rel);

  const inside = (p: string) => p === root || p.startsWith(root + path.sep);
  if (!inside(real)) throw new Error(`path "${virtual}" escapes the workspace root`);

  // Resolve symlinks on the deepest existing ancestor and re-check, so a symlink
  // inside the workspace can't redirect outside it.
  let probe = real;
  while (probe !== path.dirname(probe) && !existsSync(probe)) probe = path.dirname(probe);
  const resolved = existsSync(probe) ? realpathSync(probe) : probe;
  if (!inside(resolved)) throw new Error(`path "${virtual}" resolves (via symlink) outside the workspace root`);

  return real;
}

// Real host path → the virtual path the model sees ("/…" under the root).
export function toVirtual(cwd: string, real: string): string {
  const root = rootReal(cwd);
  const rel = path.relative(root, real);
  if (rel === "") return "/";
  if (rel.startsWith("..")) return real; // defensive — shouldn't happen for confined paths
  return "/" + rel.split(path.sep).join("/");
}
