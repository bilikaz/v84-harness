// The agent output contract — buildValidator drives the heal loop, so a wrong
// verdict either re-prompts a good answer or accepts a bad one.
import { describe, expect, it } from "vitest";

import { buildValidator } from "../src/core/agents.ts";

describe("buildValidator", () => {
  it("returns undefined when there is nothing to enforce", () => {
    expect(buildValidator(undefined)).toBeUndefined();
    expect(buildValidator({ json: false })).toBeUndefined();
  });

  it("accepts valid JSON (fenced or bare) when json is required", () => {
    const v = buildValidator({ json: true })!;
    expect(() => v('{"ok":1}')).not.toThrow();
    expect(() => v('```json\n{"ok":1}\n```')).not.toThrow();
  });

  it("rejects non-JSON with the parse cause in the message", () => {
    const v = buildValidator({ json: true })!;
    expect(() => v("not json at all")).toThrow(/not valid JSON/);
  });

  it("enforces required top-level keys on a JSON object", () => {
    const v = buildValidator({ json: true, required: ["subjects", "resolution"] })!;
    expect(() => v('{"subjects":[],"resolution":"1024"}')).not.toThrow();
    expect(() => v('{"subjects":[]}')).toThrow(/missing required key\(s\): resolution/);
    expect(() => v("[1,2]")).toThrow(/expected a JSON object/);
  });
});
