// Validated text → T. A validator throw is HEALABLE by definition here (a
// parse/shape mismatch is exactly what a re-prompt can fix) — write a custom
// handler for validation that must not heal.

import type { ResponseHandler } from "../types.ts";
import { HealError } from "../client/types.ts";
import { errorMessage } from "../../lib/errors.ts";
import { bufferEvents } from "./text.ts";

export function jsonHandler<T>(validate: (text: string) => T): ResponseHandler<T> {
  return {
    async handle(interaction) {
      if (interaction.kind !== "chat") {
        throw new Error("expected a chat interaction — this service produces media, not JSON text.");
      }
      const { text } = await bufferEvents(interaction.events);
      try {
        return validate(text);
      } catch (e) {
        throw new HealError(errorMessage(e), text);
      }
    },
  };
}
