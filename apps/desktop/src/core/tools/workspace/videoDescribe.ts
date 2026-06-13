import { DescribeTool, VIDEO_EXTS } from "./mediaFile.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const CAPS = CONFIG_DEFAULTS.media;

export class VideoDescribe extends DescribeTool {
  protected readonly toolName = "VideoDescribe";
  protected readonly kind = "video" as const;
  protected readonly exts = VIDEO_EXTS;
  protected readonly maxBytes = CAPS.videoMaxBytes;
  protected readonly slot = "videoRec" as const;
  protected readonly defaultQuery =
    "Describe this video in detail: what happens over time, the subjects and their actions, the setting, and anything notable.";
}
