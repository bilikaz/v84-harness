// Text handlers — consume a chat interaction's event stream and answer text.

import type { ResponseHandler, Interaction, StreamEvent } from "../types.ts";
import type { ChatOutcome } from "../client/types.ts";

function chatEvents(interaction: Interaction): AsyncGenerator<StreamEvent> {
  if (interaction.kind !== "chat") {
    throw new Error("expected a chat interaction — this service produces media, not text.");
  }
  return interaction.events;
}

// "retry" events restart the accumulators; "error" events throw.
export async function bufferEvents(events: AsyncGenerator<StreamEvent>): Promise<ChatOutcome> {
  let text = "";
  let thinkingChars = 0;
  let usage: ChatOutcome["usage"];
  for await (const evt of events) {
    if (evt.type === "text") text += evt.delta;
    else if (evt.type === "thinking") thinkingChars += evt.delta.length;
    else if (evt.type === "usage") usage = evt.usage;
    else if (evt.type === "retry") {
      text = "";
      thinkingChars = 0;
      usage = undefined;
    } else if (evt.type === "error") throw new Error(evt.message);
  }
  return { text, thinkingChars, usage };
}

export function textHandler(): ResponseHandler<string> {
  return {
    async handle(interaction) {
      return (await bufferEvents(chatEvents(interaction))).text.trim();
    },
  };
}

export function bufferedTextHandler(): ResponseHandler<ChatOutcome> {
  return {
    async handle(interaction) {
      return bufferEvents(chatEvents(interaction));
    },
  };
}
