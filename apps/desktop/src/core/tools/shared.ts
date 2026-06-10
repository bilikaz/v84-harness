// Cross-cutting helpers shared by the tools — mechanics, not contract (the
// vocabulary lives in types.ts per conventions/types-placement.md).

// 64 KB per tool result is plenty; truncate beyond so a runaway command can't
// blow up the model's context.
export const OUTPUT_CAP = 64 * 1024;

export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}
