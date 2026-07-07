// Context meter — usedTokens is the LATEST request's input+output; summing steps re-counts history and overflows the window.
import { describe, expect, it } from "vitest";

import { getActive, setUsage } from "../src/core/sessions/store.ts";

describe("setUsage", () => {
  it("tracks the latest request's context size, not a cumulative sum", () => {
    const sid = getActive().id;
    // 3-step tool loop: each step re-sends the full history, so input grows per step.
    setUsage(sid, 10_000 + 500);
    setUsage(sid, 10_600 + 300);
    setUsage(sid, 11_000 + 800);
    expect(getActive().meta.usedTokens).toBe(11_800);
  });

  it("ignores empty usage so a missing report keeps the last reading", () => {
    const sid = getActive().id;
    setUsage(sid, 5_000);
    setUsage(sid, 0);
    expect(getActive().meta.usedTokens).toBe(5_000);
  });
});
