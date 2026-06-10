// Granular session persistence (ADR-0021): the index, per-session message
// rows, and media blobs are separate keys, so a persist costs what changed.
// Exercised through the real LocalStorage adapter (the node-env backend) per
// testing.md — the port is the seam, the engine is real.
import { beforeEach, describe, expect, it } from "vitest";

import { LocalStorage } from "../src/lib/storage/index.ts";
import {
  deleteSessionData,
  LEGACY_KEY,
  loadIndex,
  loadMessages,
  mediaPrefix,
  migrateLegacy,
  saveMessages,
} from "../src/core/sessions/persistence.ts";
import type { ImageRef, Message } from "../src/core/sessions/types.ts";

const DATA_URL = "data:image/png;base64,AAAA";
const msg = (over: Partial<Message>): Message => ({ id: crypto.randomUUID(), role: "user", text: "hi", ...over });

beforeEach(() => localStorage.clear());

describe("saveMessages / loadMessages", () => {
  it("extracts media to its own blob key and round-trips the transcript", async () => {
    const s = await LocalStorage.create();
    const ref: ImageRef = { url: DATA_URL, mime: "image/png", name: "a.png" };
    await saveMessages(s, "s1", [msg({ images: [ref] })]);

    // The stored messages carry a ref, not megabytes of base64.
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
    const ref: ImageRef = { url: DATA_URL };
    const messages = [msg({ images: [ref] })];
    await saveMessages(s, "s1", messages);
    const id = ref.id!;
    await saveMessages(s, "s1", [...messages, msg({ text: "more" })]);
    expect(ref.id).toBe(id); // not re-minted
    expect(await s.keys(mediaPrefix("s1"))).toHaveLength(1);
  });

  it("messages sharing a ref object (media feedback) share one blob", async () => {
    const s = await LocalStorage.create();
    const ref: ImageRef = { url: DATA_URL };
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

describe("migrateLegacy", () => {
  it("splits the pre-granular blob into index + rows + blobs and deletes it", async () => {
    const s = await LocalStorage.create();
    const legacy = {
      activeId: "a",
      sessions: [
        { id: "a", title: "A", messages: [{ id: "m1", role: "user", text: "hello", images: [{ url: DATA_URL }] }] },
        { id: "b", title: "B", messages: [{ id: "m2", role: "assistant", text: "yo" }] },
      ],
    };
    await s.set(LEGACY_KEY, JSON.stringify(legacy));

    const index = (await migrateLegacy(s))!;
    expect(index.activeId).toBe("a");
    expect(index.sessions.map((m) => m.id)).toEqual(["a", "b"]);
    expect(index.sessions[0].bytes).toBeGreaterThan(0);
    expect(await s.get(LEGACY_KEY)).toBeNull();
    expect(await loadIndex(s)).not.toBeNull();

    const a = (await loadMessages(s, "a"))!;
    expect(a[0].text).toBe("hello");
    expect(a[0].images![0].url).toBe(DATA_URL);
  });

  it("returns null when there is no legacy blob", async () => {
    const s = await LocalStorage.create();
    expect(await migrateLegacy(s)).toBeNull();
  });
});
