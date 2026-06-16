import type { Registry } from "../../../core/feature.ts";
import { sessionsRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/sessions", sessionsRouter);
}
