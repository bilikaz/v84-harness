import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import { collectText } from "../../providers/client.ts";
import { getProvider } from "../../core/settings.ts";
import { sessionBus as bus } from "./events.ts";
import { errorMessage } from "../../lib/errors.ts";
import { rootLog } from "../../lib/logger/index.ts";
import {
  CONTEXT_RESERVE,
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

// Auto-compaction — when a session crosses its usable context budget (see
// contextLimit / CONTEXT_RESERVE), summarize the whole conversation and replace
// it with a single hidden summary message. Self-contained service like naming.ts
// (owns its logic + subscription, calls streamModel directly, never goes through
// the driver so it doesn't re-trigger turn events).

// Thinking is wasteful for a summary, so we force a SMALL budget for this call.
const COMPACT_THINKING_BUDGET = 2048;

const COMPACT_SYSTEM = "You compress conversations into faithful, self-contained summaries.";
const COMPACT_INSTRUCTION =
  "Summarize the entire conversation above into a compact but COMPLETE summary that can replace the full " +
  "history. Preserve: the user's goals and constraints, key decisions and their rationale, important facts, " +
  "file/code state and paths touched, tool results that still matter, and any open tasks or next steps. Use " +
  "clear sections. Omit nothing the assistant would need to continue seamlessly. Output only the summary.";

export async function compact(sid: string, cfg: ModelConfig): Promise<void> {
  const session = getSession(sid);
  if (!session || session.messages.length === 0) return;
  if (getCompactingIds().has(sid) || getStreamingIds().has(sid)) return;

  setCompacting(sid, true);
  notify();
  const controller = new AbortController();
  try {
    const messages: ChatMessage[] = [
      ...toChatMessages(session.messages),
      { role: "user", content: COMPACT_INSTRUCTION },
    ];
    // Force thinking on but tightly budgeted — a summary doesn't need deep
    // reasoning. Give the OUTPUT the full reserved headroom (NOT the user's tiny
    // maxTokens) — that reserve exists precisely for this summary.
    const reserve = cfg.contextLength ? cfg.contextLength - contextLimit(cfg) : (cfg.contextReserve ?? CONTEXT_RESERVE);
    const compactCfg: ModelConfig = {
      ...cfg,
      reasoningEffort: "low",
      thinkingBudget: COMPACT_THINKING_BUDGET,
      maxTokens: reserve,
    };
    const { text, usage } = await collectText(compactCfg, messages, controller.signal, COMPACT_SYSTEM);
    // The summary call takes a while — if the user started a new turn meanwhile,
    // replacing the transcript now would clobber it. Drop this summary; the
    // turn:end trigger fires again while the session is still over budget.
    if (getStreamingIds().has(sid)) {
      log.warn("skipped", { sid, hint: "session started streaming during compaction — summary discarded" });
      return;
    }
    const summary = text;
    const summaryTokens = (usage?.outputTokens ?? 0) - (usage?.thinkingTokens ?? 0);
    if (summary.trim()) {
      // Seed usedTokens with the summary's real size (from usage), so the context
      // meter reflects what the retained summary actually occupies — not 0.
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

// Auto-trigger: when a real turn ends over the budget, compact in the background.
const off = bus.on("turn:end", (e) => {
  if (e.errored) return;
  const cfg = getProvider();
  const s = getSession(e.sessionId);
  if (s && isFull(cfg, s)) void compact(e.sessionId, cfg);
});

if (import.meta.hot) import.meta.hot.dispose(() => off());
