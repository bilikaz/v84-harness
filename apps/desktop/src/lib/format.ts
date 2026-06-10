// Compact token counts: 262144 → "262k", 1_500_000 → "1.5M".
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Strip a leading ```json / ``` fence (and trailing ```), so a model that wraps
// its JSON answer in a code block still parses.
export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

// Trailing-slash-free base URL, for `${base}/path` concatenation.
export function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}
