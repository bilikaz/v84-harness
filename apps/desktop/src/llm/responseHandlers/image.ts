// The image payload, as produced — the image provider already fetched and
// normalized it (b64 + mime); this handler is the typed door for callers.

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
