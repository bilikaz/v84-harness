// DescribeImage/DescribeVideo — Load*'s file guards plus the linked recognition model; the call rides the real provider layer, so the mock speaks SSE.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ImageDescribe } from "../src/core/tools/workspace/imageDescribe.ts";
import { VideoDescribe } from "../src/core/tools/workspace/videoDescribe.ts";
import { createClient } from "../src/llm/index.ts";
import type { CallTarget, ModelService } from "../src/llm/types.ts";

// The describe tools resolve their recognition slot through the llm client; build one per test with the
// media slots it should know about (the same seam generate-image-wire exercises).
function llmWith(slots: Partial<Record<ModelService, CallTarget>>) {
  return createClient({ resolve: (s) => slots[s] ?? null });
}
const describeImageTool = { execute: (args: Record<string, unknown>, slots: Partial<Record<ModelService, CallTarget>>) => new ImageDescribe(llmWith(slots)).run(args, root) };
const describeVideoTool = { execute: (args: Record<string, unknown>, slots: Partial<Record<ModelService, CallTarget>>) => new VideoDescribe(llmWith(slots)).run(args, root) };

let root: string;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const REC: CallTarget = {
  provider: { name: "Rec", type: "openai", baseUrl: "http://rec:8000/v1" },
  model: { id: "qwen-vl" },
};

function sse(text: string): Response {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` + `data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
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
    const res = await describeImageTool.execute({ path: "/workspace/pic.png" }, ({}));
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not configured");
  });

  it("rejects a generate-dialect assignment with ask's typed refusal", async () => {
    const res = await describeImageTool.execute({ path: "/workspace/pic.png" }, ({ imageRec: { ...REC, provider: { ...REC.provider, type: "generate" } } }));
    expect(res.ok).toBe(false);
    expect(res.output).toContain("there is no text/generate provider");
  });

  it("rejects unsupported extensions and oversized GIFs like LoadImage", async () => {
    const ctx = ({ imageRec: REC });
    const txt = await describeImageTool.execute({ path: "/workspace/notes.txt" }, ctx);
    expect(txt.ok).toBe(false);
    expect(txt.output).toContain(".png");
    const gif = await describeImageTool.execute({ path: "/workspace/big.gif" }, ctx);
    expect(gif.ok).toBe(false);
    expect(gif.output).toContain("limit");
  });

  it("goes through the provider wire: system framing + image part, answer + preview back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse("A red square on white."));
    vi.stubGlobal("fetch", fetchMock);

    const res = await describeImageTool.execute({ path: "/workspace/pic.png", query: "What is it?" }, ({ imageRec: REC }));
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
      stream: boolean;
      messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe("qwen-vl");
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe("system");
    expect(String(body.messages[0].content)).toContain("image analysis assistant");
    const parts = body.messages[1].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts[0]).toEqual({ type: "text", text: "What is it?" });
    expect(parts[1].type).toBe("image_url");
    expect(parts[1].image_url!.url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("surfaces an endpoint error as ok:false with status + body", async () => {
    // 400 — a non-retryable class, so the failure surfaces immediately.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400, statusText: "Bad Request" })));
    const res = await describeImageTool.execute({ path: "/workspace/pic.png" }, ({ imageRec: REC }));
    expect(res.ok).toBe(false);
    expect(res.output).toContain("400");
    expect(res.output).toContain("boom");
  });
});

describe("DescribeVideo", () => {
  it("uses the videoRec slot and the video_url content part, preview on the video field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse("A short clip of nothing much."));
    vi.stubGlobal("fetch", fetchMock);

    const res = await describeVideoTool.execute({ path: "/workspace/clip.mp4" }, ({ videoRec: REC }));
    expect(res.ok).toBe(true);
    expect(res.output).toBe("A short clip of nothing much.");
    expect(res.video).toHaveLength(1);
    expect(res.video![0].mime).toBe("video/mp4");
    expect(res.images).toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string | Array<{ type: string }> }>;
    };
    expect(body.messages[0].role).toBe("system");
    expect(String(body.messages[0].content)).toContain("video analysis assistant");
    const parts = body.messages[1].content as Array<{ type: string }>;
    expect(parts[1].type).toBe("video_url");
  });

  it("is inert without an assigned videoRec model (imageRec alone doesn't count)", async () => {
    const res = await describeVideoTool.execute({ path: "/workspace/clip.mp4" }, ({ imageRec: REC }));
    expect(res.ok).toBe(false);
    expect(res.output).toContain("not configured");
  });
});
