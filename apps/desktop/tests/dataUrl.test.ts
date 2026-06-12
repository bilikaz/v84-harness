// Data-URL parse/encode — the single source shared by renderer, providers, and Electron main.
import { describe, expect, it } from "vitest";

import { bytesToB64, mimeToExt, parseDataUrl } from "../src/lib/dataUrl.ts";

describe("parseDataUrl", () => {
  it("splits a base64 data URL into mime + payload", () => {
    expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({ mime: "image/png", b64: "AAAA" });
  });

  it("returns null for http(s) URLs so callers pass them through", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
  });
});

describe("mimeToExt", () => {
  it("maps the common image types", () => {
    expect(mimeToExt("image/jpeg")).toBe("jpg");
    expect(mimeToExt("image/webp")).toBe("webp");
    expect(mimeToExt("image/png")).toBe("png");
  });

  it("maps video types with an mp4 fallback", () => {
    expect(mimeToExt("video/webm")).toBe("webm");
    expect(mimeToExt("video/mp4")).toBe("mp4");
    expect(mimeToExt("video/")).toBe("mp4");
  });
});

describe("bytesToB64", () => {
  it("round-trips through base64, including multi-chunk payloads", () => {
    const big = new Uint8Array(0x8000 * 2 + 17).map((_, i) => i % 251);
    const b64 = bytesToB64(big);
    expect(new Uint8Array(Buffer.from(b64, "base64"))).toEqual(big);
  });
});
