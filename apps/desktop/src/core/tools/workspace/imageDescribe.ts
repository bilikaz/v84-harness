import { DescribeTool, IMAGE_EXTS } from "./mediaFile.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const CAPS = CONFIG_DEFAULTS.media;

export class ImageDescribe extends DescribeTool {
  protected readonly toolName = "ImageDescribe";
  protected readonly kind = "image" as const;
  protected readonly exts = IMAGE_EXTS;
  protected readonly maxBytes = CAPS.imageMaxBytes;
  protected readonly extCaps = { gif: CAPS.gifMaxBytes };
  protected readonly slot = "imageRec" as const;
  protected readonly defaultQuery = "Describe this image in detail: subjects, layout, text, and anything notable.";
}
