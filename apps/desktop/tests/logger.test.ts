// Memory sink structural assertions (conventions/logging.md rule 6) + the scope-join format every sink must reproduce.
import { describe, expect, it } from "vitest";

import { MemoryLogger } from "../src/lib/logger/memory.ts";
import { joinScope } from "../src/lib/logger/types.ts";

describe("joinScope", () => {
  it("joins with dots and tolerates an empty parent", () => {
    expect(joinScope("", "session")).toBe("session");
    expect(joinScope("session", "naming")).toBe("session.naming");
  });
});

describe("MemoryLogger", () => {
  it("records entries with level, scope, event, and data", () => {
    const log = new MemoryLogger();
    const child = log.child("session").child("naming");
    child.warn("empty_title", { thinkingChars: 42 });
    expect(log.entries).toEqual([
      { level: "warn", scope: "session.naming", event: "empty_title", data: { thinkingChars: 42 } },
    ]);
  });

  it("children share the parent's entry list", () => {
    const log = new MemoryLogger();
    log.child("a").info("one");
    log.child("b").error("two");
    expect(log.entries.map((e) => e.scope)).toEqual(["a", "b"]);
  });
});
