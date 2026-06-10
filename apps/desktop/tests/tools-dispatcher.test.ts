// The dispatcher's never-throw contract (ADR-0007) and the output cap that
// keeps a runaway command from blowing the model's context.
import { describe, expect, it } from "vitest";

import { cap, OUTPUT_CAP } from "../src/core/tools/shared.ts";
import { cancelTool, execTool } from "../src/core/tools/index.ts";

const CTX = { cwd: "/tmp" };

describe("cap", () => {
  it("passes short output through untouched", () => {
    expect(cap("hello")).toBe("hello");
  });

  it("truncates beyond OUTPUT_CAP and says how much was dropped", () => {
    const big = "x".repeat(OUTPUT_CAP + 500);
    const capped = cap(big);
    expect(capped.length).toBeLessThan(big.length);
    expect(capped).toContain("output truncated");
    expect(capped).toContain("500 more bytes dropped");
  });
});

describe("execTool dispatcher", () => {
  it("rejects an empty tool name with the available list", async () => {
    const r = await execTool({ id: "c1", name: "", arguments: "{}" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/empty tool name/);
    expect(r.output).toMatch(/Read.*Bash/);
  });

  it("rejects an unknown tool by name", async () => {
    const r = await execTool({ id: "c2", name: "Nuke", arguments: "{}" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/unknown tool "Nuke"/);
  });

  it("rejects malformed JSON arguments with the parse error and guidance", async () => {
    const r = await execTool({ id: "c3", name: "Read", arguments: "{broken" }, CTX);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/not valid JSON/);
    expect(r.output).toMatch(/Retry with a valid JSON object/);
  });

  it("never throws — a tool failure comes back as ok:false", async () => {
    // Read against a nonexistent cwd fails inside the tool, not as a throw.
    const r = await execTool(
      { id: "c4", name: "Read", arguments: JSON.stringify({ path: "/nope.txt" }) },
      { cwd: "/definitely/not/a/real/dir" },
    );
    expect(r.ok).toBe(false);
  });

  it("cancelTool on an unknown call id is a no-op", () => {
    expect(() => cancelTool("never-ran")).not.toThrow();
  });
});
