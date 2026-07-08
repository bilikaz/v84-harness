// OpenAI-images /images/generations + /images/edits dialect — the Cosmos/FLUX container speaks this.

import { b64ToBytes, mimeToExt } from "../../../lib/dataUrl.ts";
import { llmLog } from "../../debug.ts";
import type { GenParams, MediaOut } from "../../types.ts";
import { BaseImageProvider } from "./base.ts";

export class Provider extends BaseImageProvider {
  protected async generate(prompt: string, p: GenParams): Promise<MediaOut> {
    const res = await this.request("/images/generations", {
      what: "generation endpoint",
      json: {
        model: this.target.model.id || undefined,
        prompt,
        ...(p.w && p.h ? { size: `${p.w}x${p.h}` } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        n: 1,
        response_format: "b64_json",
      },
    });
    return this.readImage(res, "generation");
  }

  // /images/edits is multipart (image file(s) + prompt). Several images = multi-reference editing (FLUX.2),
  // sent as REPEATED `image` fields: FastAPI-style servers bind `image: List[UploadFile]` and 422
  // ("body.image field required") on the `image[]` spelling — confirmed live against the FLUX container.
  // Single-image servers read the same shape. No mask (v1, whole-image).
  protected async edit(prompt: string, images: { b64: string; mime: string }[], p: GenParams): Promise<MediaOut> {
    const form = new FormData();
    form.append("prompt", prompt);
    if (this.target.model.id) form.append("model", this.target.model.id);
    form.append("n", "1");
    form.append("response_format", "b64_json");
    if (p.w && p.h) form.append("size", `${p.w}x${p.h}`);
    if (p.seed !== undefined) form.append("seed", String(p.seed));
    llmLog.debug("image_edit", { size: p.w && p.h ? `${p.w}x${p.h}` : "server-default", references: images.length, seed: p.seed });
    images.forEach((img, i) => {
      // Cast: the DOM lib types BlobPart as ArrayBufferView<ArrayBuffer>, but a Uint8Array over a plain
      // ArrayBuffer is a valid part at runtime — the mismatch is only the ArrayBufferLike vs ArrayBuffer tag.
      const blob = new Blob([b64ToBytes(img.b64) as unknown as BlobPart], { type: img.mime });
      form.append("image", blob, `image-${i}.${mimeToExt(img.mime)}`);
    });
    const res = await this.request("/images/edits", { what: "edit endpoint", form });
    return this.readImage(res, "edit");
  }

  // Shared response reader for both endpoints — b64_json (honoring output_format) or a URL to inline.
  private async readImage(res: Response, what: string): Promise<MediaOut> {
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }>; output_format?: string };
    const first = data.data?.[0];
    if (first?.b64_json) {
      // The server returns the encoding in `output_format` (e.g. "png"); honor it.
      const fmt = (data.output_format || "png").toLowerCase();
      return { b64: first.b64_json, mime: fmt === "jpg" || fmt === "jpeg" ? "image/jpeg" : `image/${fmt}` };
    }
    if (first?.url) return this.inlineUrl(first.url);
    throw new Error(`${what} response had no image (expected data[0].b64_json or data[0].url)`);
  }
}
