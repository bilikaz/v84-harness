// Virtual-root confinement (ADR-0007) — the model addresses paths under /workspace; nothing may resolve outside the workspace root, `..` and symlinks included.
// The mapping/scrub helpers are protected methods on BaseWorkspaceTool now; a tiny Probe subclass exposes them for direct unit testing.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { BaseWorkspaceTool } from "../src/core/tools/workspace/base.ts";
import type { ToolResult, ToolSpec } from "../src/core/tools/types.ts";
import { createClient } from "../src/llm/index.ts";

class Probe extends BaseWorkspaceTool {
  get schema(): ToolSpec {
    return { type: "function", function: { name: "Probe", description: "", parameters: { type: "object", properties: {} } } };
  }
  async run(): Promise<ToolResult> {
    return { ok: true, output: "" };
  }
  real(virtual: string, cwd: string): string {
    return this.resolvePath(virtual, cwd);
  }
  root(cwd: string): string {
    return this.getRoot(cwd);
  }
  expand(command: string, cwd: string): string {
    return this.expandWorkspace(command, cwd);
  }
  hide(cwd: string, out: string): string {
    return this.hideRoot(cwd, out);
  }
}

const probe = new Probe(createClient({ resolve: () => null }));

const root = mkdtempSync(path.join(tmpdir(), "harness-paths-"));
const outside = mkdtempSync(path.join(tmpdir(), "harness-outside-"));
mkdirSync(path.join(root, "src"));
writeFileSync(path.join(root, "src", "a.txt"), "a");
writeFileSync(path.join(outside, "secret.txt"), "s");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("resolvePath", () => {
  it("maps a /workspace-absolute path to the workspace root", () => {
    expect(probe.real("/workspace/src/a.txt", root)).toBe(path.join(probe.root(root), "src", "a.txt"));
  });

  it("maps a relative path to the workspace root", () => {
    expect(probe.real("src/a.txt", root)).toBe(path.join(probe.root(root), "src", "a.txt"));
  });

  it("maps the bare /workspace root", () => {
    expect(probe.real("/workspace", root)).toBe(probe.root(root));
  });

  it("refuses a leading-slash path outside /workspace", () => {
    expect(() => probe.real("/etc/passwd", root)).toThrow(/outside the workspace/);
    expect(() => probe.real("/src/a.txt", root)).toThrow(/outside the workspace/);
  });

  it("rejects '..' escapes", () => {
    expect(() => probe.real("../escape.txt", root)).toThrow(/escapes the workspace root/);
    expect(() => probe.real("/workspace/src/../../escape.txt", root)).toThrow(/escapes the workspace root/);
  });

  it("rejects symlinks that point outside the workspace", () => {
    symlinkSync(outside, path.join(root, "link-out"));
    expect(() => probe.real("/workspace/link-out/secret.txt", root)).toThrow(/resolves \(via symlink\) outside/);
  });

  it("allows symlinks that stay inside the workspace", () => {
    symlinkSync(path.join(root, "src"), path.join(root, "link-in"));
    expect(probe.real("/workspace/link-in/a.txt", root)).toBe(path.join(probe.root(root), "link-in", "a.txt"));
  });
});

describe("expandWorkspace (shell command rewrite)", () => {
  const ROOT = "/real/root";

  it("expands the /workspace marker to the real root", () => {
    expect(probe.expand("ls /workspace/src", ROOT)).toBe(`ls ${ROOT}/src`);
    expect(probe.expand("cat /workspace", ROOT)).toBe(`cat ${ROOT}`);
  });

  it("leaves a regex / URL / sed argument untouched", () => {
    expect(probe.expand("grep '/xxxxx' file", ROOT)).toBe("grep '/xxxxx' file");
    expect(probe.expand("curl http://x/y", ROOT)).toBe("curl http://x/y");
    expect(probe.expand("sed 's/a/b/' f", ROOT)).toBe("sed 's/a/b/' f");
  });

  it("does not expand a path that merely starts with the marker text", () => {
    expect(probe.expand("ls /workspaces", ROOT)).toBe("ls /workspaces");
  });
});

describe("hideRoot (output scrub)", () => {
  const ROOT = "/real/root";

  it("rewrites the real root back to /workspace", () => {
    expect(probe.hide(ROOT, `${ROOT}/src/a.ts: ok`)).toBe("/workspace/src/a.ts: ok");
    expect(probe.hide(ROOT, `at ${ROOT}`)).toBe("at /workspace");
  });
});
