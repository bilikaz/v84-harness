// Confinement tests for the tools' virtual-root path mapping — the hard safety
// rule of the tool system (ADR-0007): nothing the model addresses may resolve
// outside the workspace root, `..` and symlinks included.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { rootReal, toReal, toVirtual } from "../src/core/tools/paths.ts";

const root = mkdtempSync(path.join(tmpdir(), "harness-paths-"));
const outside = mkdtempSync(path.join(tmpdir(), "harness-outside-"));
mkdirSync(path.join(root, "src"));
writeFileSync(path.join(root, "src", "a.txt"), "a");
writeFileSync(path.join(outside, "secret.txt"), "s");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("toReal", () => {
  it("maps a leading '/' to the workspace root, not the host root", () => {
    expect(toReal(root, "/src/a.txt")).toBe(path.join(rootReal(root), "src", "a.txt"));
    expect(toReal(root, "/etc/passwd")).toBe(path.join(rootReal(root), "etc", "passwd"));
  });

  it("maps the bare root", () => {
    expect(toReal(root, "/")).toBe(rootReal(root));
  });

  it("rejects '..' escapes", () => {
    expect(() => toReal(root, "../escape.txt")).toThrow(/escapes the workspace root/);
    expect(() => toReal(root, "/src/../../escape.txt")).toThrow(/escapes the workspace root/);
  });

  it("rejects symlinks that point outside the workspace", () => {
    symlinkSync(outside, path.join(root, "link-out"));
    expect(() => toReal(root, "/link-out/secret.txt")).toThrow(/resolves \(via symlink\) outside/);
  });

  it("allows symlinks that stay inside the workspace", () => {
    symlinkSync(path.join(root, "src"), path.join(root, "link-in"));
    expect(toReal(root, "/link-in/a.txt")).toBe(path.join(rootReal(root), "link-in", "a.txt"));
  });
});

describe("toVirtual", () => {
  it("round-trips a confined path back to '/…'", () => {
    const real = toReal(root, "/src/a.txt");
    expect(toVirtual(root, real)).toBe("/src/a.txt");
  });

  it("maps the root itself to '/'", () => {
    expect(toVirtual(root, rootReal(root))).toBe("/");
  });
});
