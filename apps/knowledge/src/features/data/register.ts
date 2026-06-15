import type { Registry } from "../../core/feature.ts";
import { dataRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/data", dataRouter);
}
