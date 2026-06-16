import type { Registry } from "../../../core/feature.ts";
import { agentsRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/agents", agentsRouter);
}
