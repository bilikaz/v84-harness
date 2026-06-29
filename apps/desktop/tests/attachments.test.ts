// readAttachments must SETTLE even when a FileReader errors (regression: image/video branches set onload
// but not onerror, so a failed read left Promise.all pending forever — the whole attach op hung).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAttachments, type AttachmentLimits } from "../src/lib/attachments.ts";

const limits: AttachmentLimits = {
  imageMaxDim: 2048,
  imageMaxBytes: 50 * 1024 * 1024,
  gifMaxBytes: 6 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
};

// Minimal FileReader: a file flagged __fail fires onerror, otherwise onload. (node has no FileReader.)
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  private fire(file: { __fail?: boolean }, data: string): void {
    queueMicrotask(() => (file.__fail ? this.onerror?.() : ((this.result = data), this.onload?.())));
  }
  readAsDataURL(file: { __fail?: boolean }): void {
    this.fire(file, "data:application/octet-stream;base64,AAAA");
  }
  readAsText(file: { __fail?: boolean }): void {
    this.fire(file, "hello");
  }
}

const prev = globalThis.FileReader;
beforeAll(() => void ((globalThis as { FileReader: unknown }).FileReader = MockFileReader));
afterAll(() => void ((globalThis as { FileReader: unknown }).FileReader = prev));

// Race the result against a deadline so a regression (a hung promise) fails fast and loud.
async function settled<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("readAttachments hung")), 1000))]);
}

const file = (type: string, name: string, fail = false): unknown => ({ type, name, size: 10, __fail: fail });

describe("readAttachments error handling", () => {
  it("settles when an image read fails, dropping the bad file", async () => {
    const r = await settled(readAttachments([file("image/png", "bad.png", true)] as unknown as FileList, limits));
    expect(r.images).toHaveLength(0);
  });

  it("settles when a video read fails, dropping the bad file", async () => {
    const r = await settled(readAttachments([file("video/mp4", "bad.mp4", true)] as unknown as FileList, limits));
    expect(r.video).toHaveLength(0);
  });

  it("a failed read doesn't stall sibling files in the same batch", async () => {
    const list = [file("video/mp4", "bad.mp4", true), file("text/plain", "ok.txt")] as unknown as FileList;
    const r = await settled(readAttachments(list, limits));
    expect(r.video).toHaveLength(0);
    expect(r.files.map((f) => f.name)).toEqual(["ok.txt"]);
  });
});
