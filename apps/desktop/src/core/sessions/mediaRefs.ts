// Media reference aliases ("img-3" / "vid-1") — the per-session, model- and user-facing handle for
// media riding the transcript. Short by design: a 26-char ULID invites one-char hallucinations that
// silently miss. Pure helpers only; the counter lives in session.meta and the stamping in store.ts.

import type { Image, Video, Message } from "./types.ts";

// A whole-string ref (how a tool's `references` entry is classified) vs. tokens scattered in free
// text (how the engine scans call args for what to pre-resolve).
export const REF_EXACT_RE = /^(?:img|vid)-\d+$/;
const REF_TOKEN_RE = /\b(?:img|vid)-\d+\b/g;

export function isMediaRef(s: string): boolean {
  return REF_EXACT_RE.test(s);
}

export function extractRefTokens(text: string): Set<string> {
  return new Set(text.match(REF_TOKEN_RE) ?? []);
}

// Resolve mentioned aliases against a transcript's in-memory media (data: URLs are inflated there).
// A token that matches nothing is simply absent — the consuming tool refuses it with guidance.
export function resolveRefs(
  messages: Message[],
  tokens: Set<string>,
): Record<string, { url: string; mime?: string; name?: string }> | undefined {
  if (!tokens.size) return undefined;
  const out: Record<string, { url: string; mime?: string; name?: string }> = {};
  for (const m of messages) {
    for (const g of [...(m.images ?? []), ...(m.videos ?? [])]) {
      if (g.ref && tokens.has(g.ref) && g.url.startsWith("data:")) out[g.ref] = { url: g.url, mime: g.mime, name: g.name };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// The compaction send boundary: index of the LAST summary message, -1 when never compacted.
// (Manual reverse loop — the build's TS lib predates Array.findLastIndex.)
export function lastSummaryIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].summary) return i;
  return -1;
}

// How a media item is named in model-facing notes: `img-3 "hero.png"`, falling back for unstamped legacy items.
export function refLabel(g: Image | Video): string {
  const name = g.name ? `"${g.name}"` : "";
  if (!g.ref) return g.name || "unnamed";
  return name ? `${g.ref} ${name}` : g.ref;
}
