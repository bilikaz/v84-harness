// A backing dependency (OpenSearch, the embedding encoder) is unreachable — a
// 503, not a 500. Routes map this to a clear "service unavailable" the caller
// (and ultimately the agent) can relay to the user.
export class ServiceDownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceDownError";
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
