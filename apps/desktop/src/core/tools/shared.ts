// Cross-cutting helpers shared by the tools — 64 KB cap so runaway commands can't blow up the model's context.
export const OUTPUT_CAP = 64 * 1024;

export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}
