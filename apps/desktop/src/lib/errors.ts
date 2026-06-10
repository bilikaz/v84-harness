// Error normalization (conventions/error-handling.md rule 1). `catch (e)` binds
// `unknown`; `(e as Error).message` is a cast, not a check — it yields undefined
// when a non-Error was thrown and the message silently loses its cause. Every
// catch site goes through this helper; the `(e as Error)` cast is banned.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
