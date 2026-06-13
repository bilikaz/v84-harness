// Error normalization (conventions/error-handling.md rule 1); the `(e as Error)` cast is banned — every catch site goes through this.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
