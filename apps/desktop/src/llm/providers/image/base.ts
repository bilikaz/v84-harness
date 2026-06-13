// Abstract image provider — shared call() flow lives here.

import type { ResponseHandler, GenParams, MediaOut } from "../../types.ts";
import { BaseProvider } from "../base.ts";
import { imageHandler } from "../../responseHandlers/image.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";

export abstract class BaseImageProvider extends BaseProvider {
  // Params not sent when omitted — server defaults apply.
  protected abstract generate(prompt: string, p: GenParams): Promise<MediaOut>;

  async call<T>(handler: ResponseHandler<T>): Promise<T> {
    const payload = await this.generate(this.prompt(), this.ctx.params ?? {});
    return handler.handle({ kind: "media", payload });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return imageHandler();
  }

  protected async inlineUrl(url: string): Promise<MediaOut> {
    const img = await fetch(url, { signal: this.ctx.signal });
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    return { b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
  }
}
