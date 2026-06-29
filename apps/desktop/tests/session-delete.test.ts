// Regression: deleteSession must prune the per-session scratch sets, or a session deleted mid-stream/compaction
// leaves a stale id in streamingIds/compactingIds.
import { describe, expect, it } from "vitest";

import { createSession, deleteSession, getStreamingIds, getCompactingIds, setStreaming, setCompacting } from "../src/core/sessions/store.ts";

describe("deleteSession cleanup", () => {
  it("prunes streamingIds and compactingIds for the deleted session", () => {
    const sid = createSession({ containerId: "" });
    setStreaming(sid, true);
    setCompacting(sid, true);
    expect(getStreamingIds().has(sid)).toBe(true);
    expect(getCompactingIds().has(sid)).toBe(true);

    deleteSession(sid);
    expect(getStreamingIds().has(sid)).toBe(false);
    expect(getCompactingIds().has(sid)).toBe(false);
  });
});
