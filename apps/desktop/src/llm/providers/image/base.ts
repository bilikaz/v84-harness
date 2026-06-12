// The abstract image provider + helpers shared by the dialect classes. An
// image provider owns its request form and knows what shape it produces
// (bytes); the shared call() flow — flatten the conversation to a prompt,
// generate, hand the handler the payload — lives here, the wire form in each
// subclass's generate().

import type { ResponseHandler, GenParams, MediaOut } from "../../types.ts";
import { BaseProvider } from "../base.ts";
import { imageHandler } from "../../responseHandlers/image.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";

export abstract class BaseImageProvider extends BaseProvider {
  // One image from the flattened prompt; always bytes. Every param optional:
  // an omitted field is NOT sent, so the server's own defaults apply.
  protected abstract generate(prompt: string, p: GenParams): Promise<MediaOut>;

  async call<T>(handler: ResponseHandler<T>): Promise<T> {
    const payload = await this.generate(this.prompt(), this.ctx.params ?? {});
    return handler.handle({ kind: "media", payload });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return imageHandler();
  }

  // Some servers return a URL instead of bytes — fetch and inline it.
  protected async inlineUrl(url: string): Promise<MediaOut> {
    const img = await fetch(url, { signal: this.ctx.signal });
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    return { b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
  }
}
