// Returns the finished clip payload produced by the video provider.

import type { ResponseHandler, MediaOut } from "../types.ts";

export function videoHandler(): ResponseHandler<MediaOut> {
  return {
    async handle(interaction) {
      if (interaction.kind !== "media") {
        throw new Error("expected a media payload — this service chats, it does not generate video.");
      }
      return interaction.payload;
    },
  };
}
