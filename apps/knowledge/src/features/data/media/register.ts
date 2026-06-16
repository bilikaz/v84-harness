import type { Registry } from "../../../core/feature.ts";
import { mediaRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/media", mediaRouter);
}
