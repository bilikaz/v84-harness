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

describe("sqliteStore message put (incremental upsert)", () => {
  it("appends in commit order and upserts in place without reshuffling", () => {
    execData("messages", "put", ["s2", { id: "m1", text: "a" }]);
    execData("messages", "put", ["s2", { id: "m2", text: "b" }]);
    execData("messages", "put", ["s2", { id: "m3", text: "c" }]);
    expect(listSession("s2").map((m) => m.id)).toEqual(["m1", "m2", "m3"]);

    // Re-put an existing id (in-flight → finished): ON CONFLICT keeps the rowid, so order is preserved
    // (INSERT OR REPLACE would have jumped m1 to the end).
    execData("messages", "put", ["s2", { id: "m1", text: "a-updated" }]);
    const rows = listSession("s2") as { id: string; text: string }[];
    expect(rows.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(rows[0].text).toBe("a-updated");
  });

  it("removes a single message by id", () => {
    execData("messages", "put", ["s3", { id: "k1" }]);
    execData("messages", "put", ["s3", { id: "k2" }]);
    execData("messages", "remove", ["k1"]);
    expect(listSession("s3").map((m) => m.id)).toEqual(["k2"]);
  });
});

afterAll(() => {
  // best-effort: the temp dir is disposable
  void dir;
});
