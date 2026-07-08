// Saving generated/edited images into the workspace. Node-only (node:fs) — kept in its OWN module so the
// general ImageGenerate tool (bundled for web too) loads it DYNAMICALLY and never pulls node:fs into the web
// graph; the local ImageEdit tool (electron-only) imports it directly.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { b64ToBytes, bytesToB64, extToMime, mimeToExt } from "../../../lib/dataUrl.ts";
import { resolveWorkspacePath } from "../local/base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const DEFAULT_IMAGE_DIR = "generated-images";
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Read a reference image from the workspace by its /workspace path — the same confinement
// (resolveWorkspacePath) and byte caps as ImageLoad. Returns an error string instead of throwing,
// so the caller folds it straight into the tool refusal.
export async function readWorkspaceImage(
  virtual: string,
  cwd: string,
  caps: { imageMaxBytes: number; gifMaxBytes: number },
): Promise<{ b64: string; mime: string } | { error: string }> {
  try {
    const real = resolveWorkspacePath(virtual, cwd);
    const ext = path.extname(real).toLowerCase().replace(/^\./, "");
    const mime = IMAGE_EXTS.includes(ext) ? extToMime(ext) : undefined;
    if (!mime) return { error: `"${virtual}" is not a supported image (.png, .jpg, .jpeg, .webp, .gif).` };
    const st = await stat(real);
    if (!st.isFile()) return { error: `"${virtual}" is not a file.` };
    const capBytes = ext === "gif" ? caps.gifMaxBytes : caps.imageMaxBytes;
    if (st.size > capBytes) return { error: `"${virtual}" is ${fmtMB(st.size)} — over the ${fmtMB(capBytes)} limit.` };
    return { b64: bytesToB64(new Uint8Array(await readFile(real))), mime };
  } catch (e) {
    // fs errors carry the REAL resolved path — scrub it back to the virtual root (never leak the host fs),
    // and point at the alias route: a "file not found" here is usually a conversation image guessed as a path.
    const msg = hideRealRoot(errorMessage(e), cwd);
    return { error: `failed to read "${virtual}": ${msg}. Use List to check the path — or, for an image from the conversation (pasted or generated), use its img-N alias instead.` };
  }
}

function hideRealRoot(msg: string, cwd: string): string {
  let out = msg;
  for (const root of [safeRealRoot(cwd), path.resolve(cwd)]) {
    if (root) out = out.split(root).join("/workspace");
  }
  return out;
}

function safeRealRoot(cwd: string): string | null {
  try {
    return realpathSync(path.resolve(cwd));
  } catch {
    return null;
  }
}

// Strip any path parts / extension / unsafe chars from a model-supplied name → a bare slug. Empty if nothing survives.
function slugName(name: string): string {
  const base = path.basename(String(name)).replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[^a-zA-Z0-9._ -]/g, "").replace(/\s+/g, "-").replace(/^[.-]+/, "").slice(0, 100);
}

// A prepared save: the sanitized base name + a writer that persists the bytes once generation returns. Two-phase
// so the caller can REFUSE a name collision BEFORE spending a generation, then write the result after.
export interface PreparedSave {
  base: string; // sanitized name, no extension
  write: (mime: string, b64: string) => Promise<string>; // returns the /workspace-relative saved path
}

// Resolve where a generated/edited image will be saved and check for collisions UP FRONT (before generation).
// Returns an error string if the name is invalid, escapes the workspace, or already exists (unless overwrite).
export function prepareWorkspaceImageSave(opts: {
  root: string;
  outputDir?: string;
  name: string;
  overwrite?: boolean;
}): PreparedSave | { error: string } {
  const base = slugName(opts.name);
  if (!base) return { error: `invalid image name "${opts.name}" — use letters, numbers, dashes; no slashes or extension.` };
  const dir = (opts.outputDir && opts.outputDir.trim()) || DEFAULT_IMAGE_DIR;
  const realDir = path.resolve(opts.root, dir);
  if (realDir !== opts.root && !realDir.startsWith(opts.root + path.sep)) {
    return { error: `image output directory "${dir}" escapes the workspace.` };
  }
  // Collision is checked on the base name across all image extensions — the exact extension isn't known until
  // the server returns, so refuse if ANY <base>.<ext> already exists (unless the caller passed overwrite).
  if (!opts.overwrite) {
    const clash = IMAGE_EXTS.find((ext) => existsSync(path.join(realDir, `${base}.${ext}`)));
    if (clash) return { error: `a file named "${base}.${clash}" already exists in ${dir}/ — choose a different name, or pass overwrite: true to replace it.` };
  }
  return {
    base,
    write: async (mime, b64) => {
      const ext = mimeToExt(mime);
      const real = path.join(realDir, `${base}.${ext}`);
      await mkdir(realDir, { recursive: true });
      await writeFile(real, b64ToBytes(b64));
      return `/workspace/${dir}/${base}.${ext}`.replace(/\/+/g, "/");
    },
  };
}
