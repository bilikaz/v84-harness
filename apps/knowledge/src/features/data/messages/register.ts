import type { Registry } from "../../../core/feature.ts";
import { messagesRouter } from "./router.ts";

export function register(r: Registry): void {
  r.mount("/messages", messagesRouter);
}
