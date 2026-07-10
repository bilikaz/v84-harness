import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import type { ToolRunCtx } from "../types.ts";
import { BaseTool } from "../base.ts";
import { findLayout, LAYOUTS } from "../../gallery/catalog.ts";
import { buildPageHtml, ACCENTS, type Accent } from "../../gallery/html.ts";
import { hasPageRenderer, renderPage, PAGE } from "../../gallery/render.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { getAppConfig } from "../../config/index.ts";

const GALLERY_DIR = "galleries";

// GalleryCompose — the core page composer (implementation.md): images into a reviewed layout, rendered
// to a print-size A4 PNG. Comics feed it panels; chat feeds it photos (collages, postcards). References
// mix workspace paths and img-N aliases; the result ALWAYS rides the message (and gets its own alias),
// saving to the workspace only when one is open.
export class GalleryCompose extends BaseTool {
  override canRun(): boolean {
    return hasPageRenderer(); // electron main injects the offscreen renderer; absent elsewhere
  }

  override single(): boolean {
    return true;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "GalleryCompose",
        description:
          "Compose images into a page layout and render a print-quality A4 page (2100×2970 PNG) — photo " +
          "galleries, postcards, comic pages. Pick a layout with GalleryOptions first (handles like \"4-1\"). " +
          "`images` fills the layout's slots IN READING ORDER and must match its image count. Each image is a " +
          "workspace path or an img-N alias from the conversation. The result is returned to you (with its own " +
          "alias) and saved into the workspace's galleries folder when one is open.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            templateId: { type: "string", description: "Layout handle (\"4-1\") or id (\"four-grid\") — see GalleryOptions." },
            images: { type: "array", minItems: 1, items: { type: "string" }, description: "Slot images in reading order: workspace paths and/or img-N aliases." },
            title: {
              type: "string",
              description:
                "Masthead title (big, left). Space is APPROXIMATE — ~30 characters fit comfortably; longer titles " +
                "auto-shrink and may clip, so INSPECT the returned page and shorten/re-run if cut. Wrap one word in " +
                "*stars* to accent-color it, or use [color=#ff5148]WORD[/color] for explicit colors. Omit for a clean page.",
            },
            date: {
              type: "string",
              description: "Masthead top-right, FIRST line: a date or issue tag, e.g. \"No. 1 · July 2026\". Short (≤40 chars). [color=#hex]…[/color] markup allowed.",
            },
            credit: {
              type: "string",
              description: "Masthead top-right, SECOND line: the author / copyright / a one-liner hook, e.g. \"© 2026 <studio>\". Short (≤40 chars).",
            },
            accent: { type: "string", enum: Object.keys(ACCENTS), description: "Masthead accent color. Default red." },
            name: { type: "string", description: "Output filename (no extension/path). Omit to auto-name." },
            overwrite: { type: "boolean", description: "Replace an existing file of the same name. Default false." },
          },
          required: ["templateId", "images"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd?: string, _signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult> {
    const layout = findLayout(String(args.templateId ?? ""));
    if (!layout) {
      const handles = LAYOUTS.map((l) => l.handle).join(", ");
      return { ok: false, output: `GalleryCompose rejected: unknown layout "${String(args.templateId)}". Valid handles: ${handles} — call GalleryOptions to review them.` };
    }
    const entries = Array.isArray(args.images) ? args.images.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()) : [];
    if (entries.length !== layout.count) {
      return { ok: false, output: `GalleryCompose rejected: layout ${layout.handle} takes exactly ${layout.count} images, got ${entries.length}.` };
    }

    // Resolve every slot image to a data URL: img-N aliases from the engine-resolved map, else workspace paths.
    const srcs: string[] = [];
    for (const entry of entries) {
      if (/^(?:img|vid)-\d+$/.test(entry)) {
        const hit = ctx?.mediaRefs?.[entry];
        if (!hit || !hit.url.startsWith("data:image/")) {
          return { ok: false, output: `GalleryCompose rejected: unknown or non-image reference "${entry}" — use an image alias shown in the conversation, or a workspace path.` };
        }
        srcs.push(hit.url);
        continue;
      }
      if (!cwd) return { ok: false, output: `GalleryCompose rejected: "${entry}" looks like a path, but no workspace is open — use img-N aliases instead.` };
      const { readWorkspaceImage } = await import("../helpers/imageSave.ts");
      const read = await readWorkspaceImage(entry, cwd, getAppConfig().media);
      if ("error" in read) return { ok: false, output: `GalleryCompose rejected: ${read.error}` };
      srcs.push(`data:${read.mime};base64,${read.b64}`);
    }

    // Workspace save: collision-check BEFORE rendering (two-phase, same contract as image generation).
    let save: import("../helpers/imageSave.ts").PreparedSave | undefined;
    if (cwd) {
      const { prepareWorkspaceImageSave } = await import("../helpers/imageSave.ts");
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `gallery-${Date.now()}`;
      const prep = prepareWorkspaceImageSave({ root: cwd, outputDir: GALLERY_DIR, name, overwrite: args.overwrite === true });
      if ("error" in prep) return { ok: false, output: `GalleryCompose rejected: ${prep.error}` };
      save = prep;
    }

    try {
      const html = buildPageHtml(layout, srcs, {
        title: typeof args.title === "string" ? args.title : undefined,
        date: typeof args.date === "string" ? args.date : undefined,
        credit: typeof args.credit === "string" ? args.credit : undefined,
        accent: typeof args.accent === "string" && args.accent in ACCENTS ? (args.accent as Accent) : undefined,
      });
      const url = await renderPage(html, PAGE);
      const image: Image = { url, mime: "image/png", name: `${save?.base ?? "gallery"}.png` };
      const savedNote = save ? ` Saved to ${await save.write("image/png", url.slice(url.indexOf(",") + 1))}.` : "";
      return {
        ok: true,
        output: `Composed ${layout.count} images into layout ${layout.handle} (${layout.name}) — ${PAGE.width}×${PAGE.height} A4 page shown above.${savedNote} INSPECT the page: if the masthead title/subtitle is cut, shorten it and re-run with overwrite.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `GalleryCompose failed: ${errorMessage(e)}` };
    }
  }
}
