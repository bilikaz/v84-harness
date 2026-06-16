import type { Registry } from "../../../core/feature.ts";
import { settingsRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/settings", settingsRouter);
}
