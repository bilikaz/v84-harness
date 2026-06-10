# ADR-0025: Media resend window + aligned per-item caps

Status: accepted
Date: 2026-06-10

## Context

The whole transcript is resubmitted on every request, so every loaded or
attached image rode every later request forever. A session that browsed a photo
folder (~10 MB of images) ballooned each request body megabytes per step —
observed live: vLLM kept answering `200` while the Cloudflare proxy in front of
the endpoint timed out on multi-minute prefills, which the app saw as the model
dying. The context-token meter can't catch this: image bytes inflate request
size and prefill time long before token thresholds trip auto-compaction.

## Decision

**A sliding media resend window in `toChatMessages` — a resend policy, never
deletion.** The transcript and UI keep everything; only the request changes:

- Walking newest-first, a media item (image or video) stays live only while
  BOTH budgets hold: `MAX_LIVE_MEDIA = 5` items (bounds image tokens / prefill)
  and `MAX_LIVE_MEDIA_BYTES = 8 MB` of data-URL payload (bounds body size /
  proxy patience). Kept items form a prefix per message, so the window maps
  onto a simple slice.
- **The newest item is always sent regardless of size** — the model must never
  be blind to the media it was just given; an oversized one fails the turn
  loudly instead of vanishing silently.
- Windowed-out media is replaced, in place, by a text stub naming what was
  there and how to get it back: `[N media item(s) shown here earlier were
  removed from the context to save space: <names>. Use LoadImage/LoadVideo to
  view one again if needed.]` — eviction is always announced; "compare with the
  earlier photo" degrades to one extra Load call, not amnesia.

**Per-item caps at the door align with the window.** `LoadImage` refuses files
over 6 MB (≈8 MB as base64 — one file can never exceed the whole budget);
composer attachments get the same guard, skipping oversized media with a
visible note. Video stays at 50 MB: a rare, deliberate, single-item operation
that the newest-always rule delivers once and then retires. Plain-text file
attachments deliberately do NOT expire — they are ordinary tokens, visible to
the context meter, already per-file capped, and auto-compaction is their
eviction mechanism.

Client-side downscaling (resize photos to ~1 MP at attach/load time) is noted
as a future feature, not part of this decision.

## Consequences

- Request size and prefill time are bounded for the session's lifetime — the
  gallery failure mode is structurally impossible, with each step's request
  roughly constant size instead of monotonically growing.
- The model loses direct sight of older media and must re-load to re-inspect;
  with the endpoint's multimodal cache, a re-load is cheap server-side.
- The constants live in `core/sessions/store.ts`, promotable to per-model
  config (next to `contextReserve`) if endpoints ever need different tuning.
- Tool-role media was never resubmitted (ADR-0018) and neither counts against
  nor is affected by the window.
