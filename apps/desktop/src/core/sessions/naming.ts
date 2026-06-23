import type { ChatMessage } from "../../llm/types.ts";
import { bufferedTextHandler } from "../../llm/index.ts";
import { getAppConfig } from "../config/index.ts";
import type { Ctx } from "../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { pt } from "../prompts.ts";
import { getSession, setTitle, toChatMessages } from "./store.ts";

const log = rootLog.child("session.naming");

const TITLE_MAX_CHARS = 80;

// Auto-naming service. Does NOT go through the driver / mark the session as
// streaming. The engine triggers it on message:done (first exchange).
export async function nameSession(ctx: Ctx, sid: string): Promise<void> {
  const session = getSession(sid);
  if (!session) {
    log.warn("no_session", { sid });
    return;
  }

  const messages: ChatMessage[] = [
    ...toChatMessages(session.messages),
    { role: "user", content: pt("chatTitle.user") },
  ];
  log.debug("request", { sid, messages });

  let title = "";
  let thinkingChars = 0;
  try {
    // reasoning_effort "off" doesn't actually stop some models (e.g. Holo) from
    // thinking, so give a real budget — thinking + the short title must both fit,
    // or the title comes back empty.
    ({ text: title, thinkingChars } = await ctx.llm.call({
      service: "main",
      messages,
      system: session.system || undefined,
      params: { reasoningEffort: "off", maxTokens: getAppConfig().session.titleMaxTokens },
      handler: bufferedTextHandler(),
    }));
  } catch (e) {
    log.error("request_failed", { error: errorMessage(e) });
    return;
  }

  const raw = title;
  title = title
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.\s]+$/, "")
    .slice(0, TITLE_MAX_CHARS);
  log.debug("result", { raw, title, thinkingChars });
  if (title) setTitle(sid, title);
  else log.warn("empty_title", { hint: "model produced no answer text — title not set", thinkingChars });
}
