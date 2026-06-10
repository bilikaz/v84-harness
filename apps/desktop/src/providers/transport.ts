// Provider-agnostic transport: one request helper + one retry policy for ALL
// providers. Providers are pure wire-format mappers — they call sseRequest()
// and THROW on transport problems (non-OK status, dropped connection); this
// layer classifies the failure and re-sends, so every streamModel caller
// (chat turns, naming, compaction, upsamplers) gets recovery for free.
//
// Layering: transport retry lives HERE, below the loop — a lost connection has
// no model output to correct, so re-sending the identical request is right.
// Validation heal (core/heal.ts) stays ABOVE the loop — it repairs output that
// exists but is wrong, by injecting a correction turn.

import type { StreamEvent } from "./types.ts";
import { dlog } from "./debug.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

// fetch + status check shared by every provider. Throws HttpError on non-OK
// (carrying Retry-After when the server sent one) instead of yielding an error
// event — so the retry router below can classify it.
export async function sseRequest(tag: string, url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    dlog(`${tag} ✗`, res.status, res.statusText, errText);
    const ra = res.headers.get("retry-after")?.trim();
    const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : undefined;
    throw new HttpError(res.status, `${res.status} ${res.statusText} ${errText}`.trim(), retryAfterMs);
  }
  return res;
}

// Re-sends after the first attempt (so up to MAX+1 requests per step).
const MAX_TRANSPORT_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

// Retryable: rate limits, server-side failures (incl. Anthropic's 529
// overloaded), timeouts, and anything network-level (fetch TypeError, stream
// reset mid-read). Fatal: user aborts and 4xx client errors — a bad key or bad
// schema won't get better by resending.
function isRetryable(e: unknown): boolean {
  if ((e as DOMException)?.name === "AbortError") return false;
  if (e instanceof HttpError) return e.status === 408 || e.status === 429 || e.status >= 500;
  return true;
}

function retryDelay(e: unknown, attempt: number): number {
  if (e instanceof HttpError && e.retryAfterMs) return Math.min(e.retryAfterMs, MAX_DELAY_MS);
  const exp = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(MAX_DELAY_MS, exp / 2 + (Math.random() * exp) / 2); // full-ish jitter
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) return abort();
    const t = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// The retry router. Runs the provider stream; on a retryable transport failure
// it emits a "retry" event (consumers discard this step's partial output — the
// request is re-sent from scratch), backs off, and re-runs. A user abort
// propagates as a throw (clean stop); a fatal or budget-exhausted failure
// becomes an "error" event, preserving the existing downstream contract.
export async function* withRetry(
  make: () => AsyncGenerator<StreamEvent>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  for (let attempt = 0; ; attempt++) {
    try {
      yield* make();
      return;
    } catch (e) {
      if (signal.aborted) throw e;
      const msg = (e as Error).message || String(e);
      if (attempt >= MAX_TRANSPORT_RETRIES || !isRetryable(e)) {
        yield { type: "error", message: msg };
        return;
      }
      const delay = retryDelay(e, attempt);
      dlog("transport ↻", `attempt ${attempt + 1} failed (${msg}) — retrying in ${Math.round(delay)}ms`);
      yield { type: "retry", message: msg };
      await sleep(delay, signal);
    }
  }
}
