import type { Registry } from "../../../core/feature.ts";
import { pluginsRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/plugins", pluginsRouter);
}
