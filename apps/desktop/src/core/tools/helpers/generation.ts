import type { Quality } from "../../config/defaults.ts";

// Generation parameter helpers for the media tools: quality, aspect ratios, dimension math, and seed.

export type { Quality };

export function pickQuality(v: unknown): Quality {
  return v === "low" || v === "super" ? v : "good";
}

// Legal Cosmos aspect ratios → [w, h].
export const ASPECTS: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
};

export function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Parse a "WxH" max, tolerating x, _, -, * and spaces as separators.
export function parseDims(s?: string): { w: number; h: number } | null {
  if (!s) return null;
  const m = /^\s*(\d+)\s*[x_*-]\s*(\d+)\s*$/i.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

export function deriveSize(
  reqW: number | undefined,
  aspect: [number, number],
  max: { w: number; h: number } | null,
  fallbackW: number,
): { w: number; h: number } {
  const [aw, ah] = aspect;
  let w = Math.min(reqW ?? max?.w ?? fallbackW, max?.w ?? Infinity);
  let h = Math.round((w * ah) / aw);
  if (max?.h && h > max.h) {
    w = Math.round((w * max.h) / h);
    h = max.h;
  }
  w = Math.max(16, Math.round(w / 16) * 16);
  h = Math.max(16, Math.round(h / 16) * 16);
  return { w, h };
}

// Fresh seed per call — without it the server reuses a fixed seed and consecutive generations come out correlated.
export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

