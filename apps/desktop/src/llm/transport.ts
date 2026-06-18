// Provider-agnostic transport: sseRequest + retry.

import type { StreamEvent } from "./types.ts";
import { llmLog } from "./debug.ts";
import { errorMessage } from "../lib/errors.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

export async function sseRequest(tag: string, url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    llmLog.debug("http_error", { tag, status: res.status, statusText: res.statusText, body: errText });
    const ra = res.headers.get("retry-after")?.trim();
    const retryAfterMs = ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : undefined;
    throw new HttpError(res.status, `${res.status} ${res.statusText} ${errText}`.trim(), retryAfterMs);
  }
  return res;
}

const MAX_TRANSPORT_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

// Capacity failures are DETERMINISTIC in the payload: the prompt is too big for
// the context window, or it OOM'd the server (which vLLM may report as a 500, not
// a 400). Re-sending the identical giant prompt fails the same way and just
// re-bombards an already-struggling server — so these are terminal, not retryable,
// whatever the status code. Matched on the error body (there's no structured
// reason field); the marker list is the tunable part.
const TERMINAL_CAPACITY = /context[ _]?length|maximum context|too long|max_num_batched_tokens|out of memory|cuda.*memory|kv ?cache|too many tokens|exceeds? the (model|maximum)/i;

function isCapacityError(e: unknown): boolean {
  return e instanceof HttpError && TERMINAL_CAPACITY.test(e.message);
}

function isRetryable(e: unknown): boolean {
  if ((e as DOMException)?.name === "AbortError") return false;
  if (isCapacityError(e)) return false; // re-sending re-fails + re-bombards the server
  if (e instanceof HttpError) return e.status === 408 || e.status === 429 || e.status >= 500;
  return true;
}

function retryDelay(e: unknown, attempt: number): number {
  if (e instanceof HttpError && e.retryAfterMs) return Math.min(e.retryAfterMs, MAX_DELAY_MS);
  const exp = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(MAX_DELAY_MS, exp / 2 + (Math.random() * exp) / 2);
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
      const msg = errorMessage(e);
      if (attempt >= MAX_TRANSPORT_RETRIES || !isRetryable(e)) {
        yield {
          type: "error",
          // Capacity = context full / OOM (terminal, not resumable). A retryable-class failure that exhausted
          // its budget (5xx/429/dropped connection) is transport (resumable). A non-retryable 4xx is "other".
          kind: isCapacityError(e) ? "capacity" : isRetryable(e) ? "transport" : "other",
          message: isCapacityError(e)
            ? `The conversation is too large for the model — it exceeded the context window or the server ran out of memory. Shorten the message, remove attachments, or start a new chat. (${msg})`
            : msg,
        };
        return;
      }
      const delay = retryDelay(e, attempt);
      llmLog.debug("retry", { attempt: attempt + 1, message: msg, delayMs: Math.round(delay) });
      yield { type: "retry", message: msg };
      await sleep(delay, signal);
    }
  }
}
