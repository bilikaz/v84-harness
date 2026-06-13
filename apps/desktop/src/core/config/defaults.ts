// App tunables — typed config defaults; PURE DATA so main and renderer read the same values.

export type Quality = "low" | "good" | "super";

// guidance stays ~6 across all tiers (high guidance DEGRADES, it's not a
// quality slider); quality scales with sampling steps.
export interface QualityPreset {
  steps: number;
  guidance: number;
  flowShift?: number;
}

export interface AppConfig {
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
  };
}

export const CONFIG_DEFAULTS: AppConfig = {
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
  session: {
    contextReserve: 50_000,
    reserveMinFraction: 0.1,
    maxSteps: 50,
    titleMaxTokens: 4096,
    compactThinkingBudget: 2048,
  },
};
