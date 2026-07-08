import { describe, it, expect } from "vitest";

import { dropExtraSingleCalls } from "../src/core/sessions/engine.ts";
import type { ToolCallRequest } from "../src/llm/types.ts";

const call = (name: string, id: string): ToolCallRequest => ({ id, name, arguments: "{}", cwd: "" });
const SINGLE = new Set(["ImageGenerate", "ImageCompose"]);
const isSingle = (n: string): boolean => SINGLE.has(n);

describe("dropExtraSingleCalls", () => {
  it("keeps the FIRST call to a single tool and drops the rest (never leaves none)", () => {
    const out = dropExtraSingleCalls([call("ImageGenerate", "a"), call("ImageGenerate", "b"), call("ImageGenerate", "c")], isSingle);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the first of EACH distinct single tool independently", () => {
    const out = dropExtraSingleCalls(
      [call("ImageGenerate", "a"), call("ImageCompose", "b"), call("ImageGenerate", "c"), call("ImageCompose", "d")],
      isSingle,
    );
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("never drops non-single tools, even repeated", () => {
    const out = dropExtraSingleCalls([call("Read", "a"), call("Read", "b"), call("ImageGenerate", "c"), call("ImageGenerate", "d")], isSingle);
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("passes everything through when no tool is single", () => {
    const out = dropExtraSingleCalls([call("Read", "a"), call("Grep", "b")], () => false);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
