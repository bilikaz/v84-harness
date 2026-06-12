// The plain-generate flavor has no spec — extractImagePayload is the tolerant
// parse that finds the image in whatever JSON wrapper the server uses. These
// pin the recognized shapes (and that a URL is never misread as base64).
import { describe, expect, it } from "vitest";

import { extractImagePayload } from "../src/core/tools/generateImage.ts";

describe("extractImagePayload", () => {
  it("reads the OpenAI-ish data[0].b64_json", () => {
    expect(extractImagePayload({ data: [{ b64_json: "abc" }] })).toEqual({ b64: "abc" });
  });

  it("reads images[0] as a bare base64 string", () => {
    expect(extractImagePayload({ images: ["abc"] })).toEqual({ b64: "abc" });
  });

  it.each(["b64", "base64", "image"])("reads a top-level %s field", (field) => {
    expect(extractImagePayload({ [field]: "abc" })).toEqual({ b64: "abc" });
  });

  it("splits a data-URL into mime + payload", () => {
    expect(extractImagePayload({ image: "data:image/webp;base64,xyz" })).toEqual({ b64: "xyz", mime: "image/webp" });
  });

  it("recognizes URLs by shape, never treating them as base64", () => {
    expect(extractImagePayload({ image: "https://host/img.png" })).toEqual({ url: "https://host/img.png" });
    expect(extractImagePayload({ data: [{ url: "http://host/img.png" }] })).toEqual({ url: "http://host/img.png" });
  });

  it("returns null when nothing image-like is present", () => {
    expect(extractImagePayload({})).toBeNull();
    expect(extractImagePayload({ status: "ok", images: [] })).toBeNull();
  });
});
