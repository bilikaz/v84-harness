// Abstract video provider — owns async submission/poll/download flow.

import type { ResponseHandler, GenParams, MediaOut } from "../../types.ts";
import { BaseProvider } from "../base.ts";
import { videoHandler } from "../../responseHandlers/video.ts";

export interface VideoJob {
  id?: string;
  status?: string;
  error?: unknown;
}

// ADR-0014: no cancel API exists, so abort only stops polling.
const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 30 * 60 * 1000;

export abstract class BaseVideoProvider extends BaseProvider {
  protected abstract submit(prompt: string, p: GenParams): Promise<VideoJob>;
  protected abstract poll(jobId: string): Promise<VideoJob>;
  protected abstract content(jobId: string): Promise<MediaOut>;

  async call<T>(handler: ResponseHandler<T>): Promise<T> {
    const p = this.callCtx.params ?? {};
    const pollIntervalMs = p.pollIntervalMs ?? POLL_INTERVAL_MS;
    const timeoutMs = p.timeoutMs ?? TIMEOUT_MS;

    let job = await this.submit(this.prompt(), p);
    if (!job.id) throw new Error("video submit returned no job id");
    const jobId = job.id;

    const deadline = Date.now() + timeoutMs;
    while (job.status !== "completed") {
      if (job.status === "failed") {
        throw new Error(`video generation failed: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`);
      }
      if (Date.now() > deadline) throw new Error(`video generation timed out after ${timeoutMs / 60_000} minutes`);
      // abort stops polling only — the server job keeps running (no cancel API; ADR-0014).
      if (this.callCtx.signal.aborted) throw new Error("cancelled by the user");
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      if (this.callCtx.signal.aborted) throw new Error("cancelled by the user");
      job = await this.poll(jobId);
    }

    const payload = await this.content(jobId);
    return handler.handle({ kind: "media", payload });
  }

  defaultHandler(): ResponseHandler<unknown> {
    return videoHandler();
  }
}
