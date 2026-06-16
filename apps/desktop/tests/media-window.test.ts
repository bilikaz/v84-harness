// Media resend window — wrong windowing either re-sends every image on every request (the original failure) or starves the model of the image it was just asked about.
import { describe, expect, it } from "vitest";

import { MAX_LIVE_MEDIA, MAX_LIVE_MEDIA_BYTES, toChatMessages } from "../src/core/sessions/store.ts";
import type { MediaRef, Message } from "../src/core/sessions/types.ts";

let n = 0;
const img = (name: string, bytes = 10): MediaRef => ({
  url: `data:image/png;base64,${"x".repeat(bytes)}`,
  mime: "image/png",
  name,
});
const msg = (m: Partial<Message>): Message => ({ id: `m${n++}`, role: "user", text: "t", ...m });

describe("toChatMessages media window", () => {
  it("sends everything while under both budgets", () => {
    const out = toChatMessages([msg({ images: [img("a"), img("b")] }), msg({ images: [img("c")] })]);
    expect(out[0].images?.length).toBe(2);
    expect(out[1].images?.length).toBe(1);
    expect(out[0].content).not.toContain("removed from the context");
  });

  it("keeps only the most recent items by count and stubs the rest", () => {
    const old = msg({ images: Array.from({ length: 8 }, (_, i) => img(`old${i}`)) });
    const mid = msg({ images: Array.from({ length: 8 }, (_, i) => img(`mid${i}`)) });
    const fresh = msg({ images: Array.from({ length: 8 }, (_, i) => img(`new${i}`)) });
    const out = toChatMessages([old, mid, fresh]);
    // budget 10, newest-first: fresh keeps 8, mid keeps 2, old keeps 0
    expect(out[2].images?.length).toBe(8);
    expect(out[1].images?.length).toBe(2);
    expect(out[0].images).toBeUndefined();
    expect(out[1].content).toContain("removed from the context");
    expect(out[0].content).toContain("old0");
    expect(out[2].content).not.toContain("removed from the context");
    const total = out.reduce((sum, m) => sum + (m.images?.length ?? 0), 0);
    expect(total).toBe(MAX_LIVE_MEDIA);
  });

  it("enforces the byte budget independently of the count", () => {
    const half = Math.ceil(MAX_LIVE_MEDIA_BYTES / 2);
    const out = toChatMessages([msg({ images: [img("big-old", half)] }), msg({ images: [img("big-new", half), img("small")] })]);
    // newest message: both fit (half + small); the older half-sized one busts the byte budget
    expect(out[1].images?.length).toBe(2);
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).toContain("big-old");
  });

  it("always sends the newest item even when it alone exceeds the byte budget", () => {
    const out = toChatMessages([msg({ images: [img("huge", MAX_LIVE_MEDIA_BYTES * 2)] })]);
    expect(out[0].images?.length).toBe(1);
  });

  it("video competes for the same budget and wins as the newer item", () => {
    const photos = msg({ images: Array.from({ length: MAX_LIVE_MEDIA + 1 }, (_, i) => img(`p${i}`)) });
    const clip = msg({ videos: [{ url: "data:video/mp4;base64,v", mime: "video/mp4", name: "clip" }] });
    const out = toChatMessages([photos, clip]);
    expect(out[1].videos?.length).toBe(1);
    expect(out[0].images?.length).toBe(MAX_LIVE_MEDIA - 1); // one slot went to the newer clip
  });

  it("never sends tool-role media and never counts it against the window", () => {
    const tool = msg({ role: "tool", toolCallId: "c1", images: Array.from({ length: 9 }, (_, i) => img(`t${i}`)) });
    const user = msg({ images: [img("mine")] });
    const out = toChatMessages([tool, user]);
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).not.toContain("removed from the context"); // display-only media needs no stub
    expect(out[1].images?.length).toBe(1);
  });
});

// The model can change mid-session, so history media the CURRENT model can't take is withheld (with a note) instead of letting the endpoint 400 the turn.
describe("toChatMessages input-capability filter", () => {
  const clip = { url: "data:video/mp4;base64,v", mime: "video/mp4", name: "clip.mp4" };

  it("withholds images from a model with image input declared off, with a note", () => {
    const out = toChatMessages([msg({ images: [img("a"), img("b")] })], { image: false });
    expect(out[0].images).toBeUndefined();
    expect(out[0].content).toContain("does not accept that input type");
    expect(out[0].content).toContain("a, b");
  });

  it("applies app defaults when input is an empty object: images on, video off", () => {
    const out = toChatMessages([msg({ images: [img("a")], videos: [clip] })], {});
    expect(out[0].images?.length).toBe(1);
    expect(out[0].videos).toBeUndefined();
    expect(out[0].content).toContain("clip.mp4");
  });

  it("sends video only when declared on", () => {
    const out = toChatMessages([msg({ videos: [clip] })], { video: true });
    expect(out[0].videos?.length).toBe(1);
    expect(out[0].content ?? "").not.toContain("does not accept");
  });

  it("omitting input keeps the old send-everything behavior", () => {
    const out = toChatMessages([msg({ images: [img("a")], videos: [clip] })]);
    expect(out[0].images?.length).toBe(1);
    expect(out[0].videos?.length).toBe(1);
  });
});
