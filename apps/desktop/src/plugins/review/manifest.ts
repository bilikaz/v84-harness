// Code Review plugin — the first consumer of the graph engine. Ships a graph (graphs/review.ts) and a roster
// of reviewer agents (agents.json), seeded at boot. Settings drive the scope scan: which file extensions are
// reviewable and which directories to ignore (so the picker shows folders of real code, not node_modules).

import type { PluginManifest } from "../../core/plugins/types.ts";

export const REVIEW_SLUG = "review";

export interface ReviewSettings {
  extensions: string[]; // reviewable file extensions (the scan keeps only these)
  ignore: string[]; // directory NAMES to skip while scanning (node_modules, build output, …)
  maxReviewers: number; // cap on how many heads a run fans out to
}

export const REVIEW_DEFAULTS: ReviewSettings = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".rb", ".php", ".cs"],
  ignore: ["node_modules", "dist", "build", "out", ".git", ".next", "coverage", "vendor", "target"],
  maxReviewers: 4,
};

export const manifest: PluginManifest<ReviewSettings> = {
  slug: REVIEW_SLUG,
  name: "Code Review",
  version: "0.1.0",
  defaultEnabled: false,
  settingsDefaults: REVIEW_DEFAULTS,
  validateSettings(raw: unknown): ReviewSettings {
    const r = (raw ?? {}) as Partial<ReviewSettings>;
    const strList = (a: unknown, fallback: string[]): string[] => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : fallback);
    const n = Number(r.maxReviewers);
    return {
      extensions: strList(r.extensions, REVIEW_DEFAULTS.extensions),
      ignore: strList(r.ignore, REVIEW_DEFAULTS.ignore),
      maxReviewers: Number.isFinite(n) && n >= 1 && n <= 8 ? Math.floor(n) : 4,
    };
  },
};
