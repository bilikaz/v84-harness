import { LoadTool, VIDEO_EXTS } from "./mediaFile.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const CAPS = CONFIG_DEFAULTS.media;

export class VideoLoad extends LoadTool {
  protected readonly toolName = "VideoLoad";
  protected readonly kind = "video" as const;
  protected readonly exts = VIDEO_EXTS;
  protected readonly maxBytes = CAPS.videoMaxBytes;
}
