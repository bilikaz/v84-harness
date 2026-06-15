import type { Registry } from "../../core/feature.ts";
import { kbRouter } from "./router.ts";
import { ingestFn } from "./ingest.ts";

export function register(r: Registry): void {
  r.mount("/kb", kbRouter);
  r.inngest(ingestFn);
}
