// The OpenAI-style video jobs dialect (the Cosmos container's /videos flow):
// the three wire verbs — submit (returns immediately), poll (one short status
// check), content (download the finished clip). The TIME logic (poll cadence,
// deadline) lives in the abstract BaseVideoProvider (./base.ts) driving these
// verbs.

import type { GenParams, MediaOut } from "../../types.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";
import { BaseVideoProvider, type VideoJob } from "./base.ts";

// This file IS the video:openai provider — the factory (llm/client) resolves
// providers/video/openai.ts and constructs this class with its model data.
export class Provider extends BaseVideoProvider {
  protected async submit(prompt: string, p: GenParams): Promise<VideoJob> {
    const form = new FormData();
    form.set("prompt", prompt);
    if (this.target.model.id) form.set("model", this.target.model.id);
    if (p.w && p.h) form.set("size", `${p.w}x${p.h}`);
    if (p.numFrames !== undefined) form.set("num_frames", String(p.numFrames));
    if (p.fps !== undefined) form.set("fps", String(p.fps));
    if (p.preset) {
      form.set("num_inference_steps", String(p.preset.steps));
      form.set("guidance_scale", String(p.preset.guidance));
    }
    if (p.seed !== undefined) form.set("seed", String(p.seed));
    const res = await this.request("/videos", { what: "video submit", form });
    return (await res.json()) as VideoJob;
  }

  protected async poll(jobId: string): Promise<VideoJob> {
    const res = await this.request(`/videos/${jobId}`, { what: "video poll" });
    return (await res.json()) as VideoJob;
  }

  protected async content(jobId: string): Promise<MediaOut> {
    const res = await this.request(`/videos/${jobId}/content`, { what: "video content" });
    const ct = res.headers.get("content-type") || "";
    return { b64: bytesToB64(new Uint8Array(await res.arrayBuffer())), mime: ct.includes("video") ? ct : "video/mp4" };
  }
}
