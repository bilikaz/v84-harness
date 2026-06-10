# ADR-0006: Provider adapters behind a unified `StreamEvent` stream

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

The app targets OpenAI-compatible endpoints (including vLLM), Anthropic, and
Gemini. Their wire formats differ in auth, message shape, tool calling, thinking,
and usage reporting, but the engine must treat them identically.

## Decision

- Each provider is one adapter file exporting
  `async function* stream<Provider>(cfg, messages, signal, system, tools)` that
  yields the unified `StreamEvent` discriminated union (`text`, `thinking`,
  `tool_call`, `usage`, `retry`, `error`, …).
- `streamModel()` in `providers/index.ts` dispatches on `cfg.provider`. The
  switch is the registry — adding a provider means a new adapter file plus a case
  in the dispatch sites. Acceptable at 3–4 providers.
- Shared plumbing is mandatory, not optional:
  - `transport.ts` — `sseRequest()` (throws `HttpError` carrying status, body
    text, `Retry-After`) and `withRetry()` (abort/4xx → terminal `error` event;
    408/429/5xx → `retry` event, exponential backoff with jitter, full re-run,
    max 3 retries). Consumers reset accumulators on `retry`.
  - `sse.ts` — SSE frame parsing for all adapters.
  - `util.ts` — base-URL normalization, `safeJson`, non-streaming response
    checking. Adapters must not re-implement any of this.
- `demuxInlineThink()` is applied uniformly after `withRetry` to handle models
  that inline `<think>` tags in text.

Cross-adapter rules (each was once inconsistent; now normative):

1. **Base URLs**: normalize through the shared helper; if the configured base
   already ends with the provider's path prefix (`/v1`, `/v1beta`, …), do not
   append it again — reverse proxies depend on this.
2. **Auth**: attach credentials only when an API key is set; never send empty
   credentials.
3. **Non-streaming errors** (model listing): include status *and* response body.
4. **Tool calls**: accumulate fragments and emit only complete calls.
5. **Usage**: report once per stream, at stream end.
6. **Unsupported inputs** (e.g. video on a provider that can't take it): drop
   loudly is preferred over drop silently; at minimum the limitation is
   documented per provider.

## Consequences

- The engine (`driver.ts`) consumes one event grammar; provider quirks stay in
  adapters.
- Retry discards partial output by design (simpler than resumable streams);
  the `retry` event tells the UI/store to reset.
- `reasoningEffort` follows the Anthropic effort scale
  (off/low/medium/high/xhigh/max) and maps per provider: OpenAI-compatible gets
  `reasoning_effort` (or vLLM's `chat_template_kwargs`), Anthropic gets adaptive
  thinking + `output_config.effort` (token budgets are deprecated there and
  ignored), Gemini gets `thinkingConfig.thinkingBudget` (the user's budget, or
  dynamic). `thinkingBudget` therefore applies to OpenAI-compatible and Gemini
  only.
