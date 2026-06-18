// Portable workspace tools (ADR: kill-the-shell) — Grep/Find/Move/Copy/Delete are pure node:fs, and
// RunScript runs in a child Node process gated by developerMode. Exercised against a real temp workspace.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getConfig } from "../src/core/config/index.ts";
import { setConfigOverrides } from "../src/core/config/app.ts";
import { initTestCtx } from "./ctx.ts";
import { Copy } from "../src/core/tools/local/copy.ts";
import { Delete } from "../src/core/tools/local/delete.ts";
import { Find } from "../src/core/tools/local/find.ts";
import { Grep } from "../src/core/tools/local/grep.ts";
import { Move } from "../src/core/tools/local/move.ts";
import { Read } from "../src/core/tools/local/read.ts";
import { RunScript } from "../src/core/tools/local/runScript.ts";

initTestCtx();
const cfg = () => getConfig();

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "v84-tools-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "alpha.ts"), "const x = 1;\nhello world\n");
  await writeFile(path.join(dir, "src", "beta.md"), "# Beta\nhello there\n");
  await writeFile(path.join(dir, "notes.txt"), "plain note\n");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Grep (pure Node)", () => {
  it("finds matches across files with /workspace-relative, line-numbered output", async () => {
    const r = await new Grep(cfg).run({ pattern: "hello" }, dir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("/workspace/src/alpha.ts:2:hello world");
    expect(r.output).toContain("/workspace/src/beta.md:2:hello there");
  });

  it("reports no matches plainly", async () => {
    const r = await new Grep(cfg).run({ pattern: "nonexistent-zzz" }, dir);
    expect(r.ok).toBe(true);
    expect(r.output).toBe("(no matches)");
  });

  it("rejects an invalid regex instead of throwing", async () => {
    const r = await new Grep(cfg).run({ pattern: "(" }, dir);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/invalid regular expression/);
  });
});

describe("Find (name glob)", () => {
  it("matches a suffix glob", async () => {
    const r = await new Find(cfg).run({ pattern: "*.md" }, dir);
    expect(r.output).toBe("/workspace/src/beta.md");
  });

  it("matches a contains glob and an exact name", async () => {
    expect((await new Find(cfg).run({ pattern: "*lph*" }, dir)).output).toBe("/workspace/src/alpha.ts");
    expect((await new Find(cfg).run({ pattern: "notes.txt" }, dir)).output).toBe("/workspace/notes.txt");
  });

  it("treats the dot as a literal, not a wildcard", async () => {
    // 'notesXtxt' must NOT match "notes.txt"
    const r = await new Find(cfg).run({ pattern: "notesXtxt" }, dir);
    expect(r.output).toBe("(no matches)");
  });
});

describe("Move / Copy / Delete", () => {
  it("Move renames within the workspace", async () => {
    await writeFile(path.join(dir, "draft.md"), "draft");
    const r = await new Move(cfg).run({ from: "draft.md", to: "docs/final.md" }, dir);
    expect(r.ok).toBe(true);
    expect(existsSync(path.join(dir, "draft.md"))).toBe(false);
    expect(existsSync(path.join(dir, "docs", "final.md"))).toBe(true);
  });

  it("Copy duplicates a file", async () => {
    const r = await new Copy(cfg).run({ from: "notes.txt", to: "notes-copy.txt" }, dir);
    expect(r.ok).toBe(true);
    expect(existsSync(path.join(dir, "notes-copy.txt"))).toBe(true);
    expect(existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });

  it("Delete removes a file but refuses the workspace root", async () => {
    await writeFile(path.join(dir, "trash.txt"), "x");
    expect((await new Delete(cfg).run({ path: "trash.txt" }, dir)).ok).toBe(true);
    expect(existsSync(path.join(dir, "trash.txt"))).toBe(false);

    const root = await new Delete(cfg).run({ path: "/workspace" }, dir);
    expect(root.ok).toBe(false);
    expect(root.output).toMatch(/cannot delete the workspace root/);
  });

  it("Delete defaults to ask (mode 1)", () => {
    expect(new Delete(cfg).defaultPermission()).toBe(1);
  });
});

describe("Read paging", () => {
  it("pages a long file via offset and points at the next offset", async () => {
    const lines = Array.from({ length: 350 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(path.join(dir, "long.txt"), lines);

    const first = await new Read(cfg).run({ path: "long.txt" }, dir);
    expect(first.output).toContain("lines 1-300 of 350");
    expect(first.output).toContain(`# Next: Read {"path": "long.txt", "offset": 301}`);

    const next = await new Read(cfg).run({ path: "long.txt", offset: 301 }, dir);
    expect(next.output).toContain("lines 301-350 of 350");
    expect(next.output).toContain("350: line 350");
  });
});

describe("RunScript (developer-gated, out-of-process)", () => {
  it("is unavailable until developer mode is on", () => {
    setConfigOverrides({ developerMode: false });
    expect(new RunScript(cfg).canRun()).toBe(false);
    setConfigOverrides({ developerMode: true });
    expect(new RunScript(cfg).canRun()).toBe(true);
  });

  it("runs a script in a child Node process and returns its output + exit code", async () => {
    setConfigOverrides({ developerMode: true });
    await writeFile(path.join(dir, "hello.js"), `console.log("from script " + process.argv[2]);`);
    const r = await new RunScript(cfg).run({ path: "hello.js", args: ["hi"] }, dir);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("from script hi");
    expect(r.output).toContain("[exit: 0]");
  });

  it("defaults to ask (mode 1)", () => {
    expect(new RunScript(cfg).defaultPermission()).toBe(1);
  });
});
