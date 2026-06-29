// SQLite LOCAL store — replaceForSession must be atomic (regression: a mid-replace failure once wiped history).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { execData, openSqliteStore } from "../src/electron/sqliteStore.ts";

const dir = mkdtempSync(path.join(tmpdir(), "sqlite-store-"));
const ok = openSqliteStore(dir);

const listSession = (sid: string): { id: string }[] => execData("messages", "listBySession", [sid]) as { id: string }[];

describe("sqliteStore replaceForSession", () => {
  it("opens the store (node:sqlite available in this runtime)", () => {
    expect(ok).toBe(true);
  });

  it("rolls back the DELETE when an INSERT throws mid-replace, leaving history intact", () => {
    execData("messages", "replaceForSession", ["s1", [{ id: "a" }, { id: "b" }]]);
    expect(listSession("s1").map((m) => m.id)).toEqual(["a", "b"]);

    // A circular object makes JSON.stringify throw on the SECOND insert — after the DELETE and the first
    // insert have run. Without the transaction those would have committed and "a"/"b" would be gone.
    const circular: Record<string, unknown> = { id: "d" };
    circular.self = circular;
    expect(() => execData("messages", "replaceForSession", ["s1", [{ id: "c" }, circular]])).toThrow();

    expect(listSession("s1").map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("commits a clean replace", () => {
    execData("messages", "replaceForSession", ["s1", [{ id: "x" }]]);
    expect(listSession("s1").map((m) => m.id)).toEqual(["x"]);
  });
});

afterAll(() => {
  // best-effort: the temp dir is disposable
  void dir;
});
