// Context meter semantics — usedTokens must reflect what the context window
// actually holds: the LATEST request's input + output. Each request's input
// tokens already count the entire conversation history, so summing usage
// events across a tool loop re-counts the history once per step and the meter
// bloats past the physical window (e.g. "402k used" on a 262k model).
import { describe, expect, it } from "vitest";

import { getActive, setUsage } from "../src/core/sessions/store.ts";

describe("setUsage", () => {
  it("tracks the latest request's context size, not a cumulative sum", () => {
    const sid = getActive().id;
    // A 3-step tool loop: every step re-sends the full history, so input
    // grows a little each time. Real occupancy after the turn is the last
    // request's input + output — never the sum across steps.
    setUsage(sid, 10_000 + 500);
    setUsage(sid, 10_600 + 300);
    setUsage(sid, 11_000 + 800);
    expect(getActive().usedTokens).toBe(11_800);
  });

  it("ignores empty usage so a missing report keeps the last reading", () => {
    const sid = getActive().id;
    setUsage(sid, 5_000);
    setUsage(sid, 0);
    expect(getActive().usedTokens).toBe(5_000);
  });
});
