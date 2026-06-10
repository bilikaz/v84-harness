# Provider layer (`src/providers/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0006](../adr/0006-provider-abstraction.md))

- One adapter per provider (`openai.ts`, `anthropic.ts`, `gemini.ts`), each an
  `async function* stream<Provider>(cfg, messages, signal, system, tools)` yielding
  the unified `StreamEvent` discriminated union. `streamModel()` in `client.ts` is
  the consumer-facing API and the dispatch point (a switch on `cfg.provider` — the
  switch *is* the registry); `index.ts` is the barrel.
- Shared plumbing lives in `transport.ts` (HTTP + `HttpError` with body text and
  `Retry-After`), `sse.ts` (SSE frame parsing), and `util.ts` (URL/base helpers,
  `safeJson`, response checking). **Adapters must not re-implement these.**
- `withRetry()` wraps every stream: 4xx/abort → terminal `error` event;
  408/429/5xx → `retry` event + exponential backoff + full re-run (consumers reset
  accumulators on `retry`).
- `demuxInlineThink()` post-processes `<think>` tags uniformly for models that
  inline reasoning in text.
- Adapter template: URL helper → message/tool translation (`to<Provider>Messages`)
  → request body → `dlog()` (debug) → `sseRequest()` → parse loop → accumulate tool
  calls → yield events → single usage report.

Cross-adapter conventions (normalized in the pattern-consolidation pass):

- Base URLs are normalized by the shared helper in `util.ts`; a base that already
  contains the provider's path prefix is not double-suffixed.
- Errors from non-streaming calls (model listing) include the response body, via
  the shared response check in `util.ts`.
- Auth credentials are attached only when an API key is actually set.
- Tool-call arguments are accumulated until the provider signals the call is
  complete; emit complete calls only.
