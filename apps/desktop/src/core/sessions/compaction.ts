import type { ChatMessage } from "../../llm/types.ts";
import { bufferedTextHandler } from "../../llm/index.ts";
import { resolveMain } from "../settings.ts";
import { ctx } from "../init.ts";
import { sessionBus as bus } from "./events.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { getAppConfig } from "../config/index.ts";
import {
  contextLimit,
  getCompactingIds,
  getSession,
  getStreamingIds,
  isFull,
  notify,
  replaceWithSummary,
  setCompacting,
  toChatMessages,
} from "./store.ts";

const log = rootLog.child("session.compaction");

const COMPACT_SYSTEM = "You compress conversations into faithful, self-contained summaries.";
const COMPACT_INSTRUCTION =
  "Summarize the entire conversation above into a compact but COMPLETE summary that can replace the full " +
  "history. Preserve: the user's goals and constraints, key decisions and their rationale, important facts, " +
  "file/code state and paths touched, tool results that still matter, and any open tasks or next steps. Use " +
  "clear sections. Omit nothing the assistant would need to continue seamlessly. Output only the summary.";

export async function compact(sid: string): Promise<void> {
  const session = getSession(sid);
  if (!session || session.messages.length === 0) return;
  if (getCompactingIds().has(sid) || getStreamingIds().has(sid)) return;
  const cfg = resolveMain();
  if (!cfg) return;

  setCompacting(sid, true);
  notify();
  const controller = new AbortController();
  try {
    const messages: ChatMessage[] = [
      // Same input-capability filter as the turn loop — the endpoint would 400 on media it can't take.
      ...toChatMessages(session.messages, cfg.input ?? {}),
      { role: "user", content: COMPACT_INSTRUCTION },
    ];
    // OUTPUT gets the full reserved headroom, NOT the user's tiny maxTokens.
    const reserve = cfg.model.contextLength
      ? cfg.model.contextLength - contextLimit(cfg)
      : (cfg.contextReserve ?? getAppConfig().session.contextReserve);
    const { text, usage } = await ctx.llm.call({
      service: "main",
      messages,
      system: COMPACT_SYSTEM,
      signal: controller.signal,
      params: { reasoningEffort: "low", thinkingBudget: getAppConfig().session.compactThinkingBudget, maxTokens: reserve },
      handler: bufferedTextHandler(),
    });
    // If the user started a new turn during the call, replacing the transcript now would clobber it.
    if (getStreamingIds().has(sid)) {
      log.warn("skipped", { sid, hint: "session started streaming during compaction — summary discarded" });
      return;
    }
    const summary = text;
    const summaryTokens = (usage?.outputTokens ?? 0) - (usage?.thinkingTokens ?? 0);
    if (summary.trim()) {
      const tokens = summaryTokens > 0 ? summaryTokens : Math.ceil(summary.trim().length / 4);
      replaceWithSummary(sid, summary.trim(), tokens);
    }
  } catch (e) {
    log.warn("failed", { error: errorMessage(e) });
  } finally {
    setCompacting(sid, false);
    notify();
  }
}

const off = bus.on("turn:end", (e) => {
  if (e.errored) return;
  const cfg = resolveMain();
  const s = getSession(e.sessionId);
  if (cfg && s && isFull(cfg, s)) void compact(e.sessionId);
});

if (import.meta.hot) import.meta.hot.dispose(() => off());
