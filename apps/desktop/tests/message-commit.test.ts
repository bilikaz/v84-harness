// Commit-on-landing (ADR: incremental message persistence). A message becomes durable as it finalizes,
// not as a turn-end whole-transcript rewrite — and turn-scratch (the malformed assistant + heal
// correction) is never committed. Drives the store mutators + commitMessages directly (the listeners
// wire the same calls to the bus) and reads back what reached the durable tier.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { initTestCtx } from "./ctx.ts";
import {
  appendToLast,
  commitMessages,
  createSession,
  hydrate,
  pushHeal,
  pushTurn,
  setSessionStorage,
} from "../src/core/sessions/store.ts";
import type { StorageEngine } from "../src/core/storage/engine.ts";

let storage: StorageEngine;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // let commitMessages' async puts settle
const ids = (sid: string): Promise<string[]> => storage.repos().messages.listBySession(sid).then((m) => m.map((x) => x.text ?? ""));

beforeAll(async () => {
  storage = initTestCtx().storage;
  setSessionStorage(storage);
  await hydrate(); // flips `hydrated` on so commits are no longer no-ops
});

describe("commitMessages", () => {
  it("commits the user message at once, the assistant only when it's a real answer", async () => {
    const sid = createSession({ containerId: "c1" });
    pushTurn(sid, "hello"); // → [user, empty assistant placeholder]
    commitMessages(sid); // turn:start lands the user message
    await flush();
    expect(await ids(sid)).toEqual(["hello"]); // placeholder is not yet committable

    appendToLast(sid, "hi there"); // assistant streams its final answer
    commitMessages(sid); // turn:end commits it
    await flush();
    expect(await ids(sid)).toEqual(["hello", "hi there"]);
  });

  it("never commits the malformed answer or the heal correction", async () => {
    const sid = createSession({ containerId: "c1" });
    pushTurn(sid, "do it");
    commitMessages(sid);
    await flush();

    appendToLast(sid, "BAD malformed output"); // the assistant that will fail validation
    pushHeal(sid, "your output was invalid — fix it"); // flags malformed + correction never-persist; opens a retry assistant
    appendToLast(sid, "GOOD corrected answer");
    commitMessages(sid); // turn:end
    await flush();

    // Only the user turn and the final valid answer are durable — the malformed attempt and the hidden
    // correction stay in memory for the model but never reach storage.
    expect(await ids(sid)).toEqual(["do it", "GOOD corrected answer"]);
  });
});
