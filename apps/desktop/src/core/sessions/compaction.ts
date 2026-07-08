import type { ChatMessage } from "../../llm/types.ts";
import { bufferedTextHandler } from "../../llm/index.ts";
import { resolveMain } from "../settings.ts";
import type { Ctx } from "../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import { pt } from "../prompts.ts";
import { getAppConfig } from "../config/index.ts";
import {
  appendSummary,
  contextLimit,
  getCompactingIds,
  getSession,
  getStreamingIds,
  notify,
  setCompacting,
  toChatMessages,
} from "./store.ts";

const log = rootLog.child("session.compaction");

export async function compact(ctx: Ctx, sid: string): Promise<void> {
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
      { role: "user", content: pt("compact.instruction") },
    ];
    // OUTPUT gets the full reserved headroom, NOT the user's tiny maxTokens.
    const reserve = cfg.model.contextLength
      ? cfg.model.contextLength - contextLimit(cfg)
      : (cfg.contextReserve ?? getAppConfig().session.contextReserve);
    const { text, usage } = await ctx.llm.call({
      service: "main",
      messages,
      system: pt("compact.system"),
      signal: controller.signal,
      params: { reasoningEffort: "low", thinkingBudget: getAppConfig().session.compactThinkingBudget, maxTokens: reserve },
      handler: bufferedTextHandler(),
    });
    // If the user started a new turn during the call, appending the summary AFTER the new messages
    // would wrongly cut them out of the send window — discard, same as before.
    if (getStreamingIds().has(sid)) {
      log.warn("skipped", { sid, hint: "session started streaming during compaction — summary discarded" });
      return;
    }
    const summary = text;
    const summaryTokens = (usage?.outputTokens ?? 0) - (usage?.thinkingTokens ?? 0);
    if (summary.trim()) {
      const tokens = summaryTokens > 0 ? summaryTokens : Math.ceil(summary.trim().length / 4);
      appendSummary(sid, summary.trim(), tokens);
    }
  } catch (e) {
    log.warn("failed", { error: errorMessage(e) });
  } finally {
    setCompacting(sid, false);
    notify();
  }
}
