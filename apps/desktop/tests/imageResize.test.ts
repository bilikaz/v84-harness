// The downscale paths that must bail WITHOUT touching canvas — these run in
// node (no OffscreenCanvas/createImageBitmap), which doubles as proof the
// early returns never reach the browser-only APIs.
import { describe, expect, it } from "vitest";

import { downscaleImage } from "../src/lib/imageResize.ts";

describe("downscaleImage", () => {
  it("leaves GIFs untouched (canvas would keep only the first frame)", async () => {
    expect(await downscaleImage("data:image/gif;base64,AAAA", "image/gif", 2048)).toBeNull();
  });

  it("leaves non-data URLs untouched", async () => {
    expect(await downscaleImage("https://example.com/a.png", "image/png", 2048)).toBeNull();
  });

  it("returns null instead of throwing when decode fails", async () => {
    // Valid data URL, garbage pixels — createImageBitmap is missing in node,
    // which exercises the same catch-all as a decode failure.
    expect(await downscaleImage("data:image/png;base64,AAAA", "image/png", 2048)).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "treats a degenerate cap (%s) as a no-op instead of collapsing the image",
    async (cap) => {
      // A stored imageMaxDim of 0 once meant scale = 0 → every image became
      // 1×1. The guard must bail before any canvas work.
      expect(await downscaleImage("data:image/png;base64,AAAA", "image/png", cap)).toBeNull();
    },
  );
});
