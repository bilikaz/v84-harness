// DescribeImage / DescribeVideo — workspace media → the linked recognition
// model. The contract: same file guards as Load* (confinement, extension
// whitelist, byte caps), inert without an assigned slot model, OpenAI dialect
// required, the recognizer's text becomes the output, and the file rides the
// result as the user's preview (images/video field) exactly like LoadImage.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { describeImageTool, describeVideoTool } from "../src/core/tools/describeMedia.ts";
import type { MediaModelConfig } from "../src/core/tools/types.ts";

let root: string;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const REC: MediaModelConfig = {
  id: "m1",
  label: "Rec : qwen-vl",
  baseUrl: "http://rec:8000/v1",
  model: "qwen-vl",
  api: "openai",
};

function mockAnswer(text: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "describe-media-"));
  await writeFile(path.join(root, "pic.png"), PNG_BYTES);
  await writeFile(path.join(root, "clip.mp4"), Buffer.from("not-really-a-video"));
  await writeFile(path.join(root, "notes.txt"), "text");
  await writeFile(path.join(root, "big.gif"), Buffer.alloc(6 * 1024 * 1024 + 1));
});
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

describe("DescribeImage", () => {
  it("is inert without an assigned imageRec model", async () => {
    const res = await describeImageTool.execute({ path: "/pic.png" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not configured");
  });

  it("rejects a generate-dialect assignment with a pointer to settings", async () => {
    const res = await describeImageTool.execute({ path: "/pic.png" }, { cwd: root, media: { imageRec: { ...REC, api: "generate" } } });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("OpenAI-compatible");
  });

  it("rejects unsupported extensions and oversized GIFs like LoadImage", async () => {
    const ctx = { cwd: root, media: { imageRec: REC } };
    const txt = await describeImageTool.execute({ path: "/notes.txt" }, ctx);
    expect(txt.ok).toBe(false);
    expect(txt.output).toContain(".png");
    const gif = await describeImageTool.execute({ path: "/big.gif" }, ctx);
    expect(gif.ok).toBe(false);
    expect(gif.output).toContain("limit");
  });

  it("sends the file + query to the slot model and returns its answer with the preview attached", async () => {
    const fetchMock = mockAnswer("A red square on white.");
    vi.stubGlobal("fetch", fetchMock);

    const res = await describeImageTool.execute({ path: "/pic.png", query: "What is it?" }, { cwd: root, media: { imageRec: REC } });
    expect(res.ok).toBe(true);
    expect(res.output).toBe("A red square on white.");
    // The user's preview — same shape LoadImage returns.
    expect(res.images).toHaveLength(1);
    expect(res.images![0].name).toBe("pic.png");
    expect(res.images![0].url).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://rec:8000/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("qwen-vl");
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "What is it?" });
    expect(body.messages[0].content[1].type).toBe("image_url");
    expect(body.messages[0].content[1].image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("surfaces an endpoint error as ok:false with status + body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500, statusText: "Internal" })));
    const res = await describeImageTool.execute({ path: "/pic.png" }, { cwd: root, media: { imageRec: REC } });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("500");
    expect(res.output).toContain("boom");
  });
});

describe("DescribeVideo", () => {
  it("uses the videoRec slot and the video_url content part, preview on the video field", async () => {
    const fetchMock = mockAnswer("A short clip of nothing much.");
    vi.stubGlobal("fetch", fetchMock);

    const res = await describeVideoTool.execute({ path: "/clip.mp4" }, { cwd: root, media: { videoRec: REC } });
    expect(res.ok).toBe(true);
    expect(res.output).toBe("A short clip of nothing much.");
    expect(res.video).toHaveLength(1);
    expect(res.video![0].mime).toBe("video/mp4");
    expect(res.images).toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ type: string }> }> };
    expect(body.messages[0].content[1].type).toBe("video_url");
  });

  it("is inert without an assigned videoRec model (imageRec alone doesn't count)", async () => {
    const res = await describeVideoTool.execute({ path: "/clip.mp4" }, { cwd: root, media: { imageRec: REC } });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not configured");
  });
});
