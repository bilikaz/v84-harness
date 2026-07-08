// Media reference aliases: token extraction, transcript resolution, and the compaction send boundary.

import { describe, expect, it } from "vitest";

import { extractRefTokens, isMediaRef, refLabel, resolveRefs } from "../src/core/sessions/mediaRefs.ts";
import { toChatMessages } from "../src/core/sessions/store.ts";
import type { Message } from "../src/core/sessions/types.ts";

let seq = 0;
function msg(over: Partial<Message>): Message {
  return { id: `m${++seq}`, role: "user", text: "", ...over };
}
function img(ref?: string, name?: string): { url: string; mime: string; name?: string; ref?: string } {
  return { url: "data:image/png;base64,AAAA", mime: "image/png", name, ref };
}

describe("ref tokens", () => {
  it("classifies exact refs and rejects lookalikes", () => {
    expect(isMediaRef("img-3")).toBe(true);
    expect(isMediaRef("vid-12")).toBe(true);
    expect(isMediaRef("img-3.png")).toBe(false);
    expect(isMediaRef("/workspace/img-3.png")).toBe(false);
  });

  it("extracts every alias mentioned in an args string", () => {
    const tokens = extractRefTokens(`{"references":["img-1","img-2"],"prompt":"like vid-7 but warmer"}`);
    expect([...tokens].sort()).toEqual(["img-1", "img-2", "vid-7"]);
  });

  it("resolves tokens against transcript media and skips unknown/non-data items", () => {
    const messages = [
      msg({ images: [img("img-1", "hero.png")] }),
      msg({ images: [{ url: "https://x/y.png", ref: "img-2" }] }), // http — not resolvable content
    ];
    const out = resolveRefs(messages, new Set(["img-1", "img-2", "img-9"]));
    expect(Object.keys(out ?? {})).toEqual(["img-1"]);
    expect(out?.["img-1"].name).toBe("hero.png");
    expect(resolveRefs(messages, new Set())).toBeUndefined();
  });

  it("labels media by alias + name, falling back for unstamped items", () => {
    expect(refLabel(img("img-3", "hero.png"))).toBe(`img-3 "hero.png"`);
    expect(refLabel(img("img-3"))).toBe("img-3");
    expect(refLabel(img(undefined, "old.png"))).toBe("old.png");
    expect(refLabel(img())).toBe("unnamed");
  });
});

describe("ref annotations in toChatMessages", () => {
  it("names sent media by alias in the message content", () => {
    const out = toChatMessages([msg({ text: "look", images: [img("img-1", "shot.png")] })]);
    expect(out[0].content).toContain("look");
    expect(out[0].content).toContain(`img-1 "shot.png"`);
  });

  it("keeps aliases visible when media is hidden from a text-only model", () => {
    const out = toChatMessages([msg({ text: "here", images: [img("img-1", "shot.png")] })], { image: false });
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).toContain(`img-1 "shot.png"`);
  });
});

describe("compaction send boundary", () => {
  it("sends only the last summary and what follows", () => {
    const out = toChatMessages([
      msg({ text: "old question" }),
      msg({ text: "first summary", summary: true }),
      msg({ text: "mid question" }),
      msg({ text: "latest summary", summary: true }),
      msg({ text: "fresh question" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].content).toContain("latest summary");
    expect(out[1].content).toBe("fresh question");
  });

  it("sends everything when no summary exists", () => {
    const out = toChatMessages([msg({ text: "a" }), msg({ text: "b" })]);
    expect(out).toHaveLength(2);
  });

  it("spends the media window only on messages after the boundary", () => {
    const preBoundary = msg({ images: Array.from({ length: 10 }, (_, i) => img(`img-${i + 1}`)) });
    const post = msg({ images: [img("img-11", "fresh.png")] });
    const out = toChatMessages([preBoundary, msg({ text: "s", summary: true }), post]);
    const last = out.at(-1);
    expect(last?.images).toHaveLength(1); // pre-boundary items must not consume the budget
  });
});
