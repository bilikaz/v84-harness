// Approval Promise bridge (ADR-0013) — every queued Promise must settle.
import { describe, expect, it } from "vitest";

import {
  denyApprovalsForSession,
  getPendingApprovals,
  requestApproval,
  resolveApproval,
} from "../src/core/approvals.ts";
import type { ToolCall } from "../src/llm/types.ts";

const call = (name: string): ToolCall => ({ id: crypto.randomUUID(), name, arguments: "{}" });

function request(sessionId: string, c: ToolCall): { id: string; promise: Promise<boolean> } {
  const promise = requestApproval(sessionId, c);
  const queued = getPendingApprovals();
  return { id: queued[queued.length - 1]!.id, promise };
}

describe("approval bridge", () => {
  it("queues a pending entry and resolveApproval settles it with the verdict", async () => {
    const a = request("s1", call("Bash"));
    expect(getPendingApprovals().some((p) => p.id === a.id)).toBe(true);
    resolveApproval(a.id, true);
    await expect(a.promise).resolves.toBe(true);
    expect(getPendingApprovals().some((p) => p.id === a.id)).toBe(false);
  });

  it("denyApprovalsForSession settles ONLY that session's promises, all false", async () => {
    const doomed1 = request("s-doomed", call("Bash"));
    const doomed2 = request("s-doomed", call("Write"));
    const alive = request("s-alive", call("Bash"));

    denyApprovalsForSession("s-doomed");
    await expect(doomed1.promise).resolves.toBe(false);
    await expect(doomed2.promise).resolves.toBe(false);

    expect(getPendingApprovals().some((p) => p.id === alive.id)).toBe(true);
    resolveApproval(alive.id, true);
    await expect(alive.promise).resolves.toBe(true);
  });

  it("resolving an unknown id is a no-op", () => {
    expect(() => resolveApproval("nope", true)).not.toThrow();
  });
});
