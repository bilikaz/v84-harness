import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ToolResult, type ToolSpec } from "../types.ts";
import type { ToolRunCtx } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { isMediaRef } from "../../sessions/mediaRefs.ts";
import { parseDataUrl } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Copy a file or folder within the workspace (fs.cp, recursive — pure Node, portable). Parent dirs of the
// destination are created. Both ends are confined to /workspace. `from` also accepts a pasted-media alias
// (img-N/vid-N): aliases are session-scoped, files are the cross-session currency — Copy is the converter.
export class Copy extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "Copy",
        description:
          "Copy a file or folder within the workspace (folders copy recursively). Paths are under /workspace/ " +
          "(the root), or relative. `from` also accepts a pasted-media alias (img-N/vid-N) to save that media " +
          "as a workspace file. Missing parent directories of the destination are created.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", description: "Existing path (e.g. /workspace/template.md) or a pasted-media alias (img-3)" },
            to: { type: "string", description: "Destination path, e.g. /workspace/docs/copy.md" },
          },
          required: ["from", "to"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, _signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult> {
    const from = String(args.from ?? "");
    const to = String(args.to ?? "");
    if (!from || !to) return { ok: false, output: `Copy rejected: both "from" and "to" are required.` };
    try {
      const dest = this.resolvePath(to, cwd);
      await mkdir(path.dirname(dest), { recursive: true });
      if (isMediaRef(from)) {
        const hit = ctx?.mediaRefs?.[from];
        const parsed = hit ? parseDataUrl(hit.url) : null;
        if (!parsed) return { ok: false, output: `Copy rejected: unknown media reference "${from}" — use an alias shown in the conversation.` };
        await writeFile(dest, Buffer.from(parsed.b64, "base64"));
      } else {
        await cp(this.resolvePath(from, cwd), dest, { recursive: true });
      }
      return { ok: true, output: `copied ${from} -> ${to}` };
    } catch (e) {
      return { ok: false, output: `error copying ${from} -> ${to}: ${errorMessage(e)}` };
    }
  }
}
