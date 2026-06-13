// Typed door returning the image provider's already-normalized payload (b64 + mime).

import type { ResponseHandler, MediaOut } from "../types.ts";

export function imageHandler(): ResponseHandler<MediaOut> {
  return {
    async handle(interaction) {
      if (interaction.kind !== "media") {
        throw new Error("expected a media payload — this service chats, it does not generate images.");
      }
      return interaction.payload;
    },
  };
}
