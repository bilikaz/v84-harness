// Virtual-root confinement (ADR-0007) — the model addresses paths under /workspace; nothing may resolve outside the workspace root, `..` and symlinks included.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { rootReal, toReal, expandWorkspace, hideRoot } from "../src/core/tools/workspace/base.ts";

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
  it("maps a /workspace-absolute path to the workspace root", () => {
    expect(toReal(root, "/workspace/src/a.txt")).toBe(path.join(rootReal(root), "src", "a.txt"));
  });

  it("maps a relative path to the workspace root", () => {
    expect(toReal(root, "src/a.txt")).toBe(path.join(rootReal(root), "src", "a.txt"));
  });

  it("maps the bare /workspace root", () => {
    expect(toReal(root, "/workspace")).toBe(rootReal(root));
  });

  it("refuses a leading-slash path outside /workspace", () => {
    expect(() => toReal(root, "/etc/passwd")).toThrow(/outside the workspace/);
    expect(() => toReal(root, "/src/a.txt")).toThrow(/outside the workspace/);
  });

  it("rejects '..' escapes", () => {
    expect(() => toReal(root, "../escape.txt")).toThrow(/escapes the workspace root/);
    expect(() => toReal(root, "/workspace/src/../../escape.txt")).toThrow(/escapes the workspace root/);
  });

  it("rejects symlinks that point outside the workspace", () => {
    symlinkSync(outside, path.join(root, "link-out"));
    expect(() => toReal(root, "/workspace/link-out/secret.txt")).toThrow(/resolves \(via symlink\) outside/);
  });

  it("allows symlinks that stay inside the workspace", () => {
    symlinkSync(path.join(root, "src"), path.join(root, "link-in"));
    expect(toReal(root, "/workspace/link-in/a.txt")).toBe(path.join(rootReal(root), "link-in", "a.txt"));
  });
});

describe("expandWorkspace (shell command rewrite)", () => {
  const ROOT = "/real/root";

  it("expands the /workspace marker to the real root", () => {
    expect(expandWorkspace("ls /workspace/src", ROOT)).toBe(`ls ${ROOT}/src`);
    expect(expandWorkspace("cat /workspace", ROOT)).toBe(`cat ${ROOT}`);
  });

  it("leaves a regex / URL / sed argument untouched", () => {
    expect(expandWorkspace("grep '/xxxxx' file", ROOT)).toBe("grep '/xxxxx' file");
    expect(expandWorkspace("curl http://x/y", ROOT)).toBe("curl http://x/y");
    expect(expandWorkspace("sed 's/a/b/' f", ROOT)).toBe("sed 's/a/b/' f");
  });

  it("does not expand a path that merely starts with the marker text", () => {
    expect(expandWorkspace("ls /workspaces", ROOT)).toBe("ls /workspaces");
  });
});

describe("hideRoot (output scrub)", () => {
  const ROOT = "/real/root";

  it("rewrites the real root back to /workspace", () => {
    expect(hideRoot(`${ROOT}/src/a.ts: ok`, ROOT)).toBe("/workspace/src/a.ts: ok");
    expect(hideRoot(`at ${ROOT}`, ROOT)).toBe("at /workspace");
  });
});
