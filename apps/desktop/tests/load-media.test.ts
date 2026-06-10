// LoadImage / LoadVideo — workspace media loaders. They read bytes from the
// confined workspace root and hand them back as a data URL for the driver's
// model-feedback turn, so the contract under test is: confinement, the
// extension whitelist, the size cap, and a faithful bytes→data-URL round trip.
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadImageTool, loadVideoTool } from "../src/core/tools/loadMedia.ts";

let root: string;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "load-media-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "assets", "pic.png"), PNG_BYTES);
  await writeFile(path.join(root, "assets", "clip.mp4"), Buffer.from("not-really-a-video"));
  await writeFile(path.join(root, "notes.txt"), "text");
  await writeFile(path.join(root, "big.png"), Buffer.alloc(6 * 1024 * 1024 + 1));
});
afterAll(() => rm(root, { recursive: true, force: true }));

describe("LoadImage", () => {
  it("returns the file as a data URL on images, byte-faithful", async () => {
    const res = await loadImageTool.execute({ path: "/assets/pic.png" }, { cwd: root });
    expect(res.ok).toBe(true);
    expect(res.images).toHaveLength(1);
    expect(res.images![0].mime).toBe("image/png");
    expect(res.images![0].name).toBe("pic.png");
    expect(res.images![0].url).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    expect(res.video).toBeUndefined();
  });

  it("rejects unsupported extensions with the allowed list", async () => {
    const res = await loadImageTool.execute({ path: "/notes.txt" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain(".png");
  });

  it("rejects files over the size cap and names the size", async () => {
    const res = await loadImageTool.execute({ path: "/big.png" }, { cwd: root });
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
    const res = await loadVideoTool.execute({ path: "/assets/clip.mp4" }, { cwd: root });
    expect(res.ok).toBe(true);
    expect(res.video).toHaveLength(1);
    expect(res.video![0].mime).toBe("video/mp4");
    expect(res.images).toBeUndefined();
  });

  it("won't load an image — the whitelists don't overlap", async () => {
    const res = await loadVideoTool.execute({ path: "/assets/pic.png" }, { cwd: root });
    expect(res.ok).toBe(false);
    expect(res.output).toContain(".mp4");
  });
});
