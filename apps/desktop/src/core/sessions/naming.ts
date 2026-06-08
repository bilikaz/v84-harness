import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import { streamModel } from "../../providers/index.ts";
import { pt } from "../../lib/prompts.ts";
import { sessionBus as bus } from "./events.ts";
import { getSession, setTitle, toChatMessages } from "./store.ts";

// Auto-naming service — self-contained: owns both the logic and its
// subscription. When a brand-new session finishes its first exchange, resend the
// real conversation (system + the actual user/assistant turns) plus a final
// user message asking for a title, then assign the reply. Reasoning-off with a
// tiny cap; it does NOT go through the driver / mark the session as streaming.
async function nameSession(sid: string, cfg: ModelConfig): Promise<void> {
  const session = getSession(sid);
  if (!session) {
    console.warn("[naming] no session", sid);
    return;
  }

  const messages: ChatMessage[] = [
    ...toChatMessages(session.messages),
    { role: "user", content: pt("chatTitle.user") },
  ];
  // reasoning_effort "off" doesn't actually stop some models (e.g. Holo) from
  // thinking, so give a real budget — thinking + the short title must both fit,
  // or the title comes back empty. The demux drops <think>; only the answer text
  // becomes the title.
  const namingCfg: ModelConfig = { ...cfg, reasoningEffort: "off", maxTokens: 4096 };
  console.debug("[naming] request", { sid, model: namingCfg.model, messages });

  let title = "";
  let thinkingChars = 0;
  try {
    for await (const evt of streamModel(namingCfg, messages, new AbortController().signal, session.system || undefined)) {
      if (evt.type === "text") title += evt.delta;
      else if (evt.type === "thinking") thinkingChars += evt.delta.length;
      else if (evt.type === "error") {
        console.error("[naming] LLM returned an error:", evt.message);
        return;
      }
    }
  } catch (e) {
    console.error("[naming] request threw:", e);
    return;
  }

  const raw = title;
  title = title
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.\s]+$/, "")
    .slice(0, 80);
  console.debug("[naming] result", { raw, title, thinkingChars });
  if (title) setTitle(sid, title);
  else console.warn("[naming] empty title — not set (model produced no text;", thinkingChars, "thinking chars)");
}

const off = bus.on("message:done", (e) => {
  if (e.firstExchange && e.autoName && !e.errored) void nameSession(e.sessionId, e.cfg);
});

// Tear down on HMR so the subscription isn't duplicated on a hot reload.
if (import.meta.hot) import.meta.hot.dispose(() => off());
