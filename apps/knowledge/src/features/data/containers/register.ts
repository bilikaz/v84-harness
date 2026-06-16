import type { Registry } from "../../../core/feature.ts";
import { containersRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/containers", containersRouter);
}
