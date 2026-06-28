// A backing dependency (OpenSearch, the embedding encoder) is unreachable — a
// 503, not a 500. Routes map this to a clear "service unavailable" the caller
// (and ultimately the agent) can relay to the user.
export class ServiceDownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceDownError";
  }
}

// Matches the desktop helper: a thrown non-Error object (e.g. an API error body) serializes to JSON
// rather than the useless "[object Object]" that String() yields.
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
