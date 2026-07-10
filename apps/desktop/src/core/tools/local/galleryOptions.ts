import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseTool } from "../base.ts";
import { LAYOUTS, supportedCounts, type GalleryLayout } from "../../gallery/catalog.ts";
import { buildPreviewHtml } from "../../gallery/html.ts";
import { hasPageRenderer, renderPage } from "../../gallery/render.ts";
import { errorMessage } from "../../../lib/errors.ts";

// Previews render once per app run and are reused — the catalog is static (user decision: no regeneration).
const previewCache = new Map<string, string>();
const PREVIEW = { width: 700, height: 990 } as const; // small mockups — enough to read the layout

async function preview(l: GalleryLayout): Promise<string> {
  const hit = previewCache.get(l.id);
  if (hit) return hit;
  const url = await renderPage(buildPreviewHtml(l, PREVIEW), PREVIEW);
  previewCache.set(l.id, url);
  return url;
}

function line(l: GalleryLayout): string {
  const tags = [l.classic ? "classic" : "", l.wild ? "wild/free-form" : ""].filter(Boolean).join(", ");
  const slots = l.slots.map((s) => s.aspect).join(", ");
  return `${l.handle} "${l.name}"${tags ? ` (${tags})` : ""} — ${l.description} Slots in reading order: ${slots}.`;
}

// GalleryOptions — how the model (and, via the tool card, the user) browses layouts before composing.
// With a count: that count's layouts as preview images + full descriptions (descriptions ALWAYS ride the
// text, so a text-only model chooses correctly). Without: the whole catalog as text.
export class GalleryOptions extends BaseTool {
  override canRun(): boolean {
    return hasPageRenderer();
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "GalleryOptions",
        description:
          "Browse the gallery page layouts. Pass `count` (how many images you want on the page) to get that " +
          "count's layout options as preview images plus descriptions — then compose with GalleryCompose using " +
          "the chosen handle (e.g. \"4-1\"). Without `count`, returns a text summary of the whole catalog.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            count: { type: "number", description: `How many images the page should hold. Supported: ${supportedCounts().join(", ")}.` },
          },
          required: [],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const count = Number(args.count);
    if (!Number.isFinite(count)) {
      const byCount = supportedCounts()
        .map((c) => `${c} images:\n${LAYOUTS.filter((l) => l.count === c).map((l) => `  ${line(l)}`).join("\n")}`)
        .join("\n");
      return { ok: true, output: `Gallery layouts (call again with count for previews):\n${byCount}` };
    }
    const matches = LAYOUTS.filter((l) => l.count === count);
    if (!matches.length) {
      return { ok: false, output: `No layouts take ${count} images. Supported counts: ${supportedCounts().join(", ")}.` };
    }
    try {
      const images: Image[] = [];
      for (const l of matches) images.push({ url: await preview(l), mime: "image/png", name: `layout-${l.handle}.png` });
      const text = matches.map(line).join("\n");
      return {
        ok: true,
        output: `${matches.length} layouts for ${count} images (previews shown above, in the same order):\n${text}\nCompose with GalleryCompose { templateId: "<handle>", images: [...] }.`,
        images,
      };
    } catch (e) {
      return { ok: false, output: `GalleryOptions failed to render previews: ${errorMessage(e)}` };
    }
  }
}
