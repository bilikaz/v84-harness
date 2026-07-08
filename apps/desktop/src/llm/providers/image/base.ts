// Abstract image provider — shared call() flow lives here.

import type { ResponseHandler, GenParams, MediaOut } from "../../types.ts";
import { BaseProvider } from "../base.ts";
import { imageHandler } from "../../responseHandlers/image.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";

export abstract class BaseImageProvider extends BaseProvider {
  // Params not sent when omitted — server defaults apply.
  protected abstract generate(prompt: string, p: GenParams): Promise<MediaOut>;

  // Prompt-driven edit of one or more input images (/images/edits). Only the dialects that expose an edit
  // endpoint override this; the rest reject it, so an imageEdit slot on a non-edit provider fails clearly.
  protected edit(_prompt: string, _images: { b64: string; mime: string }[], _p: GenParams): Promise<MediaOut> {
    throw new Error("this image provider does not support editing (no /images/edits endpoint)");
  }

  async call<T>(handler: ResponseHandler<T>): Promise<T> {
    const p = this.callCtx.params ?? {};
    // Input images → edit; otherwise text-to-image generation. Same provider, two endpoints.
    const payload = p.images?.length ? await this.edit(this.prompt(), p.images, p) : await this.generate(this.prompt(), p);
    return handler.handle({ kind: "media", payload });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return imageHandler();
  }

  protected async inlineUrl(url: string): Promise<MediaOut> {
    const img = await fetch(url, { signal: this.callCtx.signal });
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    return { b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
  }
}
