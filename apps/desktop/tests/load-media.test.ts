// LoadImage/LoadVideo loaders — confinement, extension whitelist, and byte caps (transport sanity for resizable images, strict for GIF the renderer can't downscale — ADR-0027).
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ImageLoad } from "../src/core/tools/workspace/imageLoad.ts";
import { VideoLoad } from "../src/core/tools/workspace/videoLoad.ts";
import { createClient } from "../src/llm/index.ts";

// Loaders only touch cwd; the llm client is unused, so a null-resolver client suffices.
const llm = createClient({ resolve: () => null });
const loadImageTool = { execute: (args: Record<string, unknown>, { cwd }: { cwd: string }) => new ImageLoad(llm).run(args, cwd) };
const loadVideoTool = { execute: (args: Record<string, unknown>, { cwd }: { cwd: string }) => new VideoLoad(llm).run(args, cwd) };

let root: string;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "load-media-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "pic.png"), PNG_BYTES);
  await writeFile(path.join(root, "assets", "clip.mp4"), Buffer.from("not-really-a-video"));
  await writeFile(path.join(root, "notes.txt"), "text");
  await writeFile(path.join(root, "big.png"), Buffer.alloc(6 * 1024 * 1024 + 1));
  await writeFile(path.join(root, "big.gif"), Buffer.alloc(6 * 1024 * 1024 + 1));
  await writeFile(path.join(root, "huge.png"), Buffer.alloc(50 * 1024 * 1024 + 1));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("LoadImage", () => {
  it("returns the file as a data URL on images, byte-faithful", async () => {
    const res = await loadImageTool.execute({ path: "/workspace/assets/pic.png" }, { cwd: root });
    expect(res.ok).toBe(true);
    expect(res.images).toHaveLength(1);
    expect(res.images![0].mime).toBe("image/png");
    expect(res.images![0].name).toBe("pic.png");
    expect(res.images![0].url).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    expect(res.video).toBeUndefined();
  });

  it("rejects unsupported extensions with the allowed list", async () => {
    const res = await loadImageTool.execute({ path: "/workspace/notes.txt" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain(".png");
  });

  it("loads a resizable image over the old 6 MB cap — bytes are transport sanity, not a model limit", async () => {
    const res = await loadImageTool.execute({ path: "/workspace/big.png" }, { cwd: root });
    expect(res.ok).toBe(true);
  });

  it("rejects a resizable image over the transport bound and names the size", async () => {
    const res = await loadImageTool.execute({ path: "/workspace/huge.png" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("50.0 MB limit");
  });

  it("keeps the strict cap for GIF — the renderer can't downscale it", async () => {
    const res = await loadImageTool.execute({ path: "/workspace/big.gif" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("6.0 MB limit");
  });

  it("confines paths to the workspace root", async () => {
    const res = await loadImageTool.execute({ path: "../escape.png" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("escapes the workspace root");
  });

  it("rejects a missing path argument", async () => {
    const res = await loadImageTool.execute({}, { cwd: root });
    expect(res.ok).toBe(false);
  });
});

describe("LoadVideo", () => {
  it("returns the file as a data URL on video (not images)", async () => {
    const res = await loadVideoTool.execute({ path: "/workspace/assets/clip.mp4" }, { cwd: root });
    expect(res.ok).toBe(true);
    expect(res.video).toHaveLength(1);
    expect(res.video![0].mime).toBe("video/mp4");
    expect(res.images).toBeUndefined();
  });

  it("won't load an image — the whitelists don't overlap", async () => {
    const res = await loadVideoTool.execute({ path: "/workspace/assets/pic.png" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain(".mp4");
  });
});
