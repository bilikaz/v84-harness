// App tunables — typed config defaults; PURE DATA so main and renderer read the same values.

export type Quality = "low" | "good" | "super";

// guidance stays ~6 across all tiers (high guidance DEGRADES, it's not a
// quality slider); quality scales with sampling steps.
export interface QualityPreset {
  steps: number;
  guidance: number;
  flowShift?: number;
}

export interface ConfigApp {
  // The user's global system prompt — the BASE block for plain-chat sessions (agents + workspaces override
  // it; capability instructions still append). Empty = use the built-in default.
  systemPrompt: string;
  // Developer mode (off by default). Gates developer-only tools: when off, RunScript isn't advertised at all,
  // so a regular user never sees it. Only someone who turns this on (and approves each call) can run code.
  developerMode: boolean;
  media: {
    // Default longest-side cap (px) for image inputs when the model card
    // doesn't set its own (ModelConfig.imageMaxDim). Most VLMs are trained
    // around ~2048px — anything bigger only burns visual tokens.
    imageMaxDim: number;
    // Transport sanity bounds (bytes), NOT model limits — the model check for
    // images is dimensions (ADR-0027). Resizable images get a generous cap: it
    // only guards reading an insane file into memory and shipping it over IPC;
    // right after, the renderer downscales it. GIF is the one format the
    // resizer passes through (canvas would drop the animation), so bytes are
    // its only guard — kept strict. Video is never resized (ADR-0025).
    imageMaxBytes: number;
    gifMaxBytes: number;
    videoMaxBytes: number;
  };
  imageGen: {
    // Width used when the model omits one and the entry has no maxSize.
    fallbackWidth: number;
    quality: Record<Quality, QualityPreset>;
  };
  videoGen: {
    fps: number;
    // Async job flow (submit → poll → download): poll cadence and the overall
    // deadline. Generation is SLOW — minutes per second of video.
    pollIntervalMs: number;
    timeoutMs: number;
    fallbackWidth: number;
    defaultDurationS: number;
    maxDurationS: number;
    quality: Record<Quality, QualityPreset>;
  };
  // The llm client's heal cycle (validated calls re-prompt until accepted).
  llm: {
    // Heal RETRIES after the initial attempt (so up to N+1 model calls).
    maxHealAttempts: number;
  };
  // The prompt-upsampling heal loop (re-prompts until the output validates).
  upsample: { maxAttempts: number };
  browser: {
    // Network-idle settle cap (ms): after a page's document loads, the fleet waits for in-flight
    // requests to quiet down (JS-rich pages fetch content after load) before reading, up to this cap.
    settleMs: number;
    // Extra fixed grace (ms) after the network settles, before the page counts as loaded — late assets
    // (images especially) often arrive in this window.
    graceMs: number;
    // How many viewport screenshots a read/describe captures down the page (top + lower sections).
    shots: number;
  };
  session: {
    // Tokens kept free below the context window (headroom for the response +
    // auto-compaction summary) when the model card doesn't set its own.
    contextReserve: number;
    // The reserve can't go below this fraction of the context window.
    reserveMinFraction: number;
    // Runaway guard for the tool loop (steps per turn).
    maxSteps: number;
    // Auto-naming output budget: stray thinking AND the short title must both
    // fit, or the title comes back empty (reasoning "off" doesn't actually
    // stop some models from thinking).
    titleMaxTokens: number;
    // Auto-compaction thinking budget — a summary doesn't need deep reasoning.
    compactThinkingBudget: number;
    // Async sub-agent orchestration: when on, RunAgent returns immediately and
    // the parent is pushed each child's result as it finishes (instead of
    // blocking the turn until all children are done). Off = the classic
    // await-all-children behaviour.
    asyncAgents: boolean;
    // How a finished child's result reaches the parent (async mode only):
    // "synthetic" fabricates a getAgentContent call+result into history (no extra
    // round-trip); "nudge" injects a notice and lets the model call it.
    asyncDelivery: "synthetic" | "nudge";
    // Concurrency runner: how long a session's provider BINDING (affinity, not a
    // held slot) survives idle — a return within this window re-warms KV on the
    // same provider; after it, the binding is dropped (KV is gone anyway).
    runnerTtlMs: number;
    // KV-protect threshold (tokens): when a warm session's bound provider is full,
    // a context at or above this waits for it (re-routing would re-prefill); a
    // smaller one roams to the next free model in the pool instead.
    kvProtectThreshold: number;
  };
}

export const CONFIG_DEFAULTS: ConfigApp = {
  systemPrompt: "",
  developerMode: false,
  media: {
    imageMaxDim: 2048,
    imageMaxBytes: 50 * 1024 * 1024,
    gifMaxBytes: 6 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
  },
  imageGen: {
    fallbackWidth: 1024,
    quality: {
      low: { steps: 40, guidance: 6, flowShift: 10 }, // fast drafts
      good: { steps: 60, guidance: 6, flowShift: 10 }, // default
      super: { steps: 80, guidance: 6, flowShift: 10 }, // final / hero images
    },
  },
  videoGen: {
    fps: 24,
    pollIntervalMs: 5_000,
    timeoutMs: 30 * 60 * 1000,
    fallbackWidth: 1280,
    defaultDurationS: 2,
    maxDurationS: 10,
    quality: {
      low: { steps: 40, guidance: 6 },
      good: { steps: 60, guidance: 6 },
      super: { steps: 80, guidance: 6 },
    },
  },
  llm: { maxHealAttempts: 3 },
  upsample: { maxAttempts: 3 },
  browser: { settleMs: 5000, graceMs: 2000, shots: 2 },
  session: {
    contextReserve: 50_000,
    reserveMinFraction: 0.1,
    maxSteps: 50,
    titleMaxTokens: 4096,
    compactThinkingBudget: 2048,
    asyncAgents: true,
    asyncDelivery: "nudge",
    runnerTtlMs: 10 * 60 * 1000,
    kvProtectThreshold: 16_000,
  },
};
