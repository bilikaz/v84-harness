// Graph engine proof (event-driven node model): runs graphs through the GraphEngine with a stubbed ctx (no
// live LLM) and asserts the contract — goTo chains, fan-out + arrival-driven goToAll join, pattern Select,
// and the strict-JSON heal on an agent head.
import { describe, expect, it, beforeEach } from "vitest";

import "../src/core/sessions/listeners.ts";
import { getSession, getStreamingIds } from "../src/core/sessions/store.ts";
import { BaseGraph, GraphEngine, registerGraph, clearGraphs } from "../src/core/graph/index.ts";
import type { GraphNode, SelectAnswer } from "../src/core/graph/types.ts";
import type { TurnResult } from "../src/core/sessions/index.ts";
import type { Ctx } from "../src/core/ctx.ts";

const ok = (text: string): TurnResult => ({ text, errored: false, aborted: false });

function stubCtx(head: (task: string) => TurnResult = () => ok("")): Ctx {
  const inflight = new Map<string, AbortController>();
  return {
    sessions: {
      registerInflight: (sid: string, c: AbortController) => inflight.set(sid, c),
      clearInflight: (sid: string) => inflight.delete(sid),
      sendTo: (_sid: string, task: string) => Promise.resolve(head(task)),
      resume: () => Promise.resolve(head("__resume__")),
      awaitSettled: (_sid: string, _sig: AbortSignal, dispatch: Promise<TurnResult | null>) => dispatch,
    },
  } as unknown as Ctx;
}

class TwoNode extends BaseGraph {
  constructor() {
    super();
    this.pluginSlug = "t";
    this.fileName = "two";
  }
  readonly entry = "a";
  readonly nodes: Record<string, GraphNode> = {
    a: { start: () => ({ value: 1 }), end: () => ({ goTo: "b" }) },
    b: { start: () => ({ value: 1 }), end: () => ({ done: "done" }) },
  };
}

class FanJoin extends BaseGraph {
  constructor() {
    super();
    this.pluginSlug = "t";
    this.fileName = "fan";
  }
  readonly entry = "split";
  readonly nodes: Record<string, GraphNode> = {
    split: { start: () => ({ value: 0 }), end: () => ({ splitTo: "work", inputs: [{ name: "x" }, { name: "y" }] }) },
    work: { start: () => ({ value: 0 }), end: (ctx) => ({ goToAll: "sum", input: ctx.name }) },
    sum: { start: (_ctx, all) => ({ value: all }), end: (_ctx, res) => ({ done: (res as string[]).slice().sort().join(",") }) },
  };
}

class SelPat extends BaseGraph {
  constructor() {
    super();
    this.pluginSlug = "t";
    this.fileName = "sel";
  }
  readonly entry = "s";
  readonly nodes: Record<string, GraphNode> = {
    s: {
      start: () => ({ modal: { id: "pick", prompt: "?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], source: "pattern", patternAnswer: ["y"] } }),
      end: (_ctx, _input, response) => ({ done: JSON.stringify((response as SelectAnswer | null)?.selected ?? []) }),
    },
  };
}

class HealG extends BaseGraph {
  constructor() {
    super();
    this.pluginSlug = "t";
    this.fileName = "heal";
  }
  readonly entry = "r";
  readonly nodes: Record<string, GraphNode> = {
    r: { start: () => ({ agent: { task: "go", schema: { required: ["x"] } } }), end: (_ctx, _input, response) => ({ done: (response as { text: string }).text }) },
  };
}

describe("GraphEngine", () => {
  beforeEach(() => clearGraphs());

  it("drives a goTo chain and builds the transcript", async () => {
    registerGraph(new TwoNode());
    const { sid, result } = new GraphEngine(stubCtx()).start("t:two");
    expect(getSession(sid)?.graphId).toBe("t:two");
    expect((await result).text).toBe("done");
    expect(getStreamingIds().has(sid)).toBe(false);
  });

  it("errors (not hangs) when the graphId is not registered", async () => {
    expect(await new GraphEngine(stubCtx()).start("t:missing").result).toMatchObject({ errored: true, errorKind: "other" });
  });

  it("fan-out + arrival-driven goToAll: join fires only once EVERY member arrives", async () => {
    registerGraph(new FanJoin());
    expect((await new GraphEngine(stubCtx()).start("t:fan").result).text).toBe("x,y");
  });

  it("resolves a pattern Select synthetically", async () => {
    registerGraph(new SelPat());
    expect((await new GraphEngine(stubCtx()).start("t:sel").result).text).toBe(JSON.stringify(["y"]));
  });

  it("heals an agent head's bad JSON (missing field → correction → valid)", async () => {
    registerGraph(new HealG());
    const head = (task: string): TurnResult => ok(task === "go" ? "{}" : '{"x":1}');
    expect((await new GraphEngine(stubCtx(head)).start("t:heal").result).text).toContain('"x":1');
  });

  it("heals UNPARSEABLE JSON via resume (never re-sends the broken reply)", async () => {
    registerGraph(new HealG());
    // First reply is broken JSON; the retry comes back valid. (resume() drops the broken one from history.)
    const head = (task: string): TurnResult => ok(task === "go" ? '{"x":' : '{"x":1}');
    expect((await new GraphEngine(stubCtx(head)).start("t:heal").result).text).toContain('"x":1');
  });

  it("a failed (errored) head forwards nothing, not the error text", async () => {
    registerGraph(new HealG());
    const head = (): TurnResult => ({ text: "⚠️ 400 bad request", errored: true, aborted: false });
    expect((await new GraphEngine(stubCtx(head)).start("t:heal").result).text).toBe("");
  });
});
