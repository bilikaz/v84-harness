// Granular session persistence (ADR-0021) — index, message rows, and media blobs are separate keys; exercised through the real LocalStorage adapter (the port is the seam).
import { beforeEach, describe, expect, it } from "vitest";

import { LocalStorage } from "../src/lib/storage/index.ts";
import {
  deleteSessionData,
  loadMessages,
  mediaPrefix,
  saveMessages,
} from "../src/core/sessions/persistence.ts";
import type { MediaRef, Message } from "../src/core/sessions/types.ts";

const DATA_URL = "data:image/png;base64,AAAA";
const msg = (over: Partial<Message>): Message => ({ id: crypto.randomUUID(), role: "user", text: "hi", ...over });

beforeEach(() => localStorage.clear());

describe("saveMessages / loadMessages", () => {
  it("extracts media to its own blob key and round-trips the transcript", async () => {
    const s = await LocalStorage.create();
    const ref: MediaRef = { url: DATA_URL, mime: "image/png", name: "a.png" };
    await saveMessages(s, "s1", [msg({ images: [ref] })]);

    const storedRaw = (await s.get("v84-harness:sessions:msgs:s1"))!;
    expect(storedRaw).not.toContain("base64,AAAA");
    expect(storedRaw).toContain(`media:${ref.id}`);
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(1);

    const loaded = (await loadMessages(s, "s1"))!;
    expect(loaded[0].images![0].url).toBe(DATA_URL);
    expect(loaded[0].images![0].id).toBe(ref.id);
  });

  it("writes a blob once: the id stamp marks it stored across persists", async () => {
    const s = await LocalStorage.create();
    const ref: MediaRef = { url: DATA_URL };
    const messages = [msg({ images: [ref] })];
    await saveMessages(s, "s1", messages);
    const id = ref.id!;
    await saveMessages(s, "s1", [...messages, msg({ text: "more" })]);
    expect(ref.id).toBe(id); // not re-minted
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(1);
  });

  it("messages sharing a ref object (media feedback) share one blob", async () => {
    const s = await LocalStorage.create();
    const ref: MediaRef = { url: DATA_URL };
    await saveMessages(s, "s1", [msg({ images: [ref] }), msg({ hidden: true, images: [ref] })]);
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(1);
  });

  it("GCs blobs orphaned by a transcript rewrite (compaction)", async () => {
    const s = await LocalStorage.create();
    await saveMessages(s, "s1", [msg({ images: [{ url: DATA_URL }] })]);
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(1);
    await saveMessages(s, "s1", [msg({ text: "summary", summary: true })]);
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(0);
  });
});

describe("deleteSessionData", () => {
  it("removes the session's rows and all its media blobs", async () => {
    const s = await LocalStorage.create();
    await saveMessages(s, "s1", [msg({ images: [{ url: DATA_URL }] })]);
    await deleteSessionData(s, "s1");
    expect(await loadMessages(s, "s1")).toBeNull();
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(0);
  });
});
