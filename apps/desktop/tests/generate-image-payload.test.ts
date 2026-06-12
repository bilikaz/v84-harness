// extractImagePayload's recognized shapes — the bare generate dialect has no spec, so this tolerant parse is the contract.
import { describe, expect, it } from "vitest";

import { extractImagePayload } from "../src/llm/providers/image/generate.ts";

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
