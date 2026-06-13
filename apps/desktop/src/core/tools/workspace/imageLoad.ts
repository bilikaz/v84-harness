import { LoadTool, IMAGE_EXTS } from "./mediaFile.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

// Transport sanity bounds, not model limits (ADR-0027) — main never sees the renderer's override store, so the caps are defaults by design.
const CAPS = CONFIG_DEFAULTS.media;

export class ImageLoad extends LoadTool {
  protected readonly toolName = "ImageLoad";
  protected readonly kind = "image" as const;
  protected readonly exts = IMAGE_EXTS;
  protected readonly maxBytes = CAPS.imageMaxBytes;
  protected readonly extCaps = { gif: CAPS.gifMaxBytes };
}
