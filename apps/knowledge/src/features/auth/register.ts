import type { Registry } from "../../core/feature.ts";
import { authRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/auth", authRouter);
}
