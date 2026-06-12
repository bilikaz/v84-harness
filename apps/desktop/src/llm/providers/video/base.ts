// The abstract video provider — it owns TIME: the shared call() flow submits
// the job, keeps checking it until there's something, then downloads and
// hands the handler the clip (a synchronous request would hold the connection
// for minutes and die with a NetworkError even though the server finishes).
// Each subclass owns its dialect's three wire verbs.

import type { ResponseHandler, GenParams, MediaOut } from "../../types.ts";
import { BaseProvider } from "../base.ts";
import { videoHandler } from "../../responseHandlers/video.ts";

export interface VideoJob {
  id?: string;
  status?: string;
  error?: unknown;
}

// Job-flow pacing when the caller doesn't pass its own (config-fed via
// GenParams) — generation is SLOW, minutes per second of video.
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 30 * 60 * 1000;

export abstract class BaseVideoProvider extends BaseProvider {
  // Submit the job (returns immediately) → the job descriptor.
  protected abstract submit(prompt: string, p: GenParams): Promise<VideoJob>;
  // One short status check.
  protected abstract poll(jobId: string): Promise<VideoJob>;
  // Download the finished clip.
  protected abstract content(jobId: string): Promise<MediaOut>;

  async call<T>(handler: ResponseHandler<T>): Promise<T> {
    const p = this.ctx.params ?? {};
    const pollIntervalMs = p.pollIntervalMs ?? POLL_INTERVAL_MS;
    const timeoutMs = p.timeoutMs ?? TIMEOUT_MS;

    // 1. Submit (returns immediately).
    let job = await this.submit(this.prompt(), p);
    if (!job.id) throw new Error("video submit returned no job id");
    const jobId = job.id;

    // 2. Keep checking until completed/failed (short requests — no long-held
    // connection). Generation can run many minutes.
    const deadline = Date.now() + timeoutMs;
    while (job.status !== "completed") {
      if (job.status === "failed") {
        throw new Error(`video generation failed: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`);
      }
      if (Date.now() > deadline) throw new Error(`video generation timed out after ${timeoutMs / 60_000} minutes`);
      // Stop ends the POLLING — the server job keeps running (no cancel API; ADR-0014).
      if (this.ctx.signal.aborted) throw new Error("cancelled by the user");
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      if (this.ctx.signal.aborted) throw new Error("cancelled by the user");
      job = await this.poll(jobId);
    }

    // 3. Deliver.
    const payload = await this.content(jobId);
    return handler.handle({ kind: "media", payload });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return videoHandler();
  }
}
