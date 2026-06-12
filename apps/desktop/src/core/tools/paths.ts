import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

// Virtual-root path mapping + confinement: the model sees the workspace root as "/"; anything escaping cwd (`..`, symlinks) is REJECTED.

export function rootReal(cwd: string): string {
  return realpathSync(path.resolve(cwd));
}

export function toReal(cwd: string, virtual: string): string {
  const root = rootReal(cwd);
  const rel = String(virtual).replace(/^[/\\]+/, ""); // leading "/" = workspace root, not host root
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

// Real host path → the virtual path the model sees ("/…" under the root).
export function toVirtual(cwd: string, real: string): string {
  const root = rootReal(cwd);
  const rel = path.relative(root, real);
  if (rel === "") return "/";
  if (rel.startsWith("..")) return real; // defensive — shouldn't happen for confined paths
  return "/" + rel.split(path.sep).join("/");
}
