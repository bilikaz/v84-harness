// The clip payload, as produced — the video provider owns the whole jobs flow
// (submit → poll → download) and hands the finished clip here.

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
