import type { Registry } from "../../../core/feature.ts";
import { pluginDataRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/plugin-data", pluginDataRouter);
}
