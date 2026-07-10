// Integration: the code-review graph end to end on the event-driven engine, no live LLM. User selects are
// answered through the real Select bridge; reviewer/consolidator heads are mocked by task. Verifies the full
// flow: scope → aspect → count → fan-out reviewers → verify → arrival-driven join → consolidate → present.
import { describe, expect, it, beforeEach } from "vitest";

import "../src/core/sessions/listeners.ts";
import { createSession, getSession } from "../src/core/sessions/store.ts";
import { GraphEngine, registerGraph, clearGraphs, getPendingSelects, resolveSelect } from "../src/core/graph/index.ts";
import ReviewGraph from "../src/plugins/review/graphs/review.ts";
import type { TurnResult } from "../src/core/sessions/index.ts";
import type { Ctx } from "../src/core/ctx.ts";
import { classify } from "../src/core/sessions/loop/contract.ts";

const ok = (text: string): TurnResult => ({ text, errored: false, aborted: false });

function stubCtx(head: (task: string) => TurnResult): Ctx {
  const inflight = new Map<string, AbortController>();
  // A contract-loop double over the REAL classify: errored/unparseable → resume, missing fields →
  // correction, bounded — enough to exercise the graph's routing against real contract semantics.
  const runContract = (sid: string, spec: { task?: string; schema?: Record<string, unknown>; reattach?: boolean }) => ({
    settled: (async () => {
      let reply = head(spec.task && !spec.reattach ? spec.task : "__resume__");
      for (let i = 0; i < 4; i++) {
        if (reply.aborted) return { sessionId: sid, ok: false, data: "aborted" };
        if (reply.errored) {
          reply = head("__resume__");
          continue;
        }
        const v = classify(reply.text, spec.schema);
        if (v.ok) return { sessionId: sid, ok: true, data: v.text };
        reply = head(v.fault === "missing-fields" ? `missing: ${(v.missing ?? []).join(", ")}` : "__resume__");
      }
      return { sessionId: sid, ok: false, data: "errored" };
    })(),
  });
  return {
    sessions: {
      registerInflight: (sid: string, c: AbortController) => inflight.set(sid, c),
      clearInflight: (sid: string) => inflight.delete(sid),
      killLoop: () => {},
      sendTo: (_sid: string, task: string) => Promise.resolve(head(task)),
      resume: () => Promise.resolve(head("__resume__")),
      runContract,
    },
  } as unknown as Ctx;
}
// Reviewers, verifier, AND the consolidator all return the same findings shape; the consolidated JSON is
// rendered by the exit node as the final ```json output.
const FINDINGS = JSON.stringify({ findings: [{ file: "foo.ts", line: 12, severity: "high", claim: "off-by-one", rationale: "loop bound" }] });

function head(): TurnResult {
  return ok(FINDINGS);
}

describe("review graph", () => {
  beforeEach(() => clearGraphs());

  it("runs scope → mode(several) → pick reviewers → review → verify → join → consolidate → present", async () => {
    const g = new ReviewGraph();
    g.pluginSlug = "review";
    g.fileName = "review";
    registerGraph(g);

    const sid = createSession({ graphId: "review:review" });
    const result = new GraphEngine(stubCtx(head)).command(sid, "start");

    // Answer the user selects through the bridge as they appear: scope → mode(several) → pick two reviewers.
    const answers: Record<string, string[]> = { scope: ["/workspace"], mode: ["several"], reviewers: ["logic", "security"] };
    let settled = false;
    void result.finally(() => {
      settled = true;
    });
    for (let guard = 0; guard < 2000 && !settled; guard++) {
      for (const p of getPendingSelects().filter((x) => x.sessionId === sid)) resolveSelect(p.id, answers[p.spec.id] ?? []);
      await new Promise((r) => setTimeout(r, 0));
    }

    const turn = await result;
    expect(turn.errored).toBe(false);
    // The consolidated findings are rendered as the final json block.
    expect(turn.text).toContain("foo.ts");
    expect(turn.text).toContain("off-by-one");
    // count=2 → two reviewer heads spawned as children under the orchestrator.
    const children = (getSession(sid)?.messages ?? []).flatMap((m) => m.childSessionIds ?? []);
    expect(children.length).toBeGreaterThanOrEqual(2);
  });
});
