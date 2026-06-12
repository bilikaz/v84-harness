// Retry router classification (ADR-0006) — retryable emits "retry" and re-runs, fatal emits "error", user abort throws; streams are plain generators, no network.
import { describe, expect, it } from "vitest";

import { HttpError, withRetry } from "../src/llm/transport.ts";
import type { StreamEvent } from "../src/llm/types.ts";

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const evt of gen) out.push(evt);
  return out;
}

function makeOnce(events: StreamEvent[], failFirstWith?: unknown): () => AsyncGenerator<StreamEvent> {
  let attempt = 0;
  return async function* () {
    attempt += 1;
    if (failFirstWith !== undefined && attempt === 1) throw failFirstWith;
    yield* events;
  };
}

describe("withRetry", () => {
  it("passes a clean stream through untouched", async () => {
    const events: StreamEvent[] = [{ type: "text", delta: "hi" }, { type: "done" }];
    const got = await drain(withRetry(makeOnce(events), new AbortController().signal));
    expect(got).toEqual(events);
  });

  it("retries a 429: emits a retry event, then the re-run's output", async () => {
    const events: StreamEvent[] = [{ type: "text", delta: "ok" }, { type: "done" }];
    const make = makeOnce(events, new HttpError(429, "429 Too Many Requests", 10 /* fast Retry-After */));
    const got = await drain(withRetry(make, new AbortController().signal));
    expect(got[0]).toMatchObject({ type: "retry" });
    expect(got.slice(1)).toEqual(events);
  });

  it("does NOT retry a 4xx client error — terminal error event", async () => {
    const make = makeOnce([], new HttpError(401, "401 Unauthorized bad key"));
    const got = await drain(withRetry(make, new AbortController().signal));
    expect(got).toEqual([{ type: "error", message: "401 Unauthorized bad key" }]);
  });

  it("a user abort propagates as a throw (clean stop), not an error event", async () => {
    const controller = new AbortController();
    controller.abort();
    const make = makeOnce([], new DOMException("Aborted", "AbortError"));
    await expect(drain(withRetry(make, controller.signal))).rejects.toThrow();
  });

  it("exhausts the retry budget into a terminal error event", async () => {
    // Always-failing retryable stream: 4 attempts (1 + 3 retries), then error.
    const make = async function* (): AsyncGenerator<StreamEvent> {
      throw new HttpError(503, "503 Service Unavailable", 1);
    };
    const got = await drain(withRetry(make, new AbortController().signal));
    expect(got.filter((e) => e.type === "retry")).toHaveLength(3);
    expect(got[got.length - 1]).toMatchObject({ type: "error" });
  });
});
