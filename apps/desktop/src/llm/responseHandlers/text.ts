// Text handlers — consume a chat interaction's event stream and answer text.

import type { ResponseHandler, Interaction, StreamEvent } from "../types.ts";
import type { ChatOutcome } from "../client/types.ts";

// Guard: these handlers read chat events; a media payload here means the
// caller pointed a text expectation at a generation service.
function chatEvents(interaction: Interaction): AsyncGenerator<StreamEvent> {
  if (interaction.kind !== "chat") {
    throw new Error("expected a chat interaction — this service produces media, not text.");
  }
  return interaction.events;
}

// Drain a chat stream to completion — the buffered consumption shared by the
// text-shaped handlers (and naming/compaction via bufferedTextHandler).
// Transport retries arrive as "retry" events → restart the accumulators; a
// final transport failure arrives as "error" → throw.
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

// The model's trimmed text, no validation (never heals).
export function textHandler(): ResponseHandler<string> {
  return {
    async handle(interaction) {
      return (await bufferEvents(chatEvents(interaction))).text.trim();
    },
  };
}

// The full buffered chat outcome (text + thinking size + usage) — for callers
// that meter tokens or thinking (naming, compaction).
export function bufferedTextHandler(): ResponseHandler<ChatOutcome> {
  return {
    async handle(interaction) {
      return bufferEvents(chatEvents(interaction));
    },
  };
}
