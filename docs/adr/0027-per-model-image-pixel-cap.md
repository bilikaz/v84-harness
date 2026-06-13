# ADR-0027: Images are model-checked by dimensions; bytes become transport bounds

Status: accepted
Date: 2026-06-11

## Context

The byte caps from ADR-0025 bound request *size*, not request *pixels*. A
heavily-compressed PNG sails under the 6 MB door at dimensions that explode
into tens of thousands of visual tokens — observed live: a 5342×6858 screenshot
wedged the vLLM engine outright until the server's visual-token budget was
raised, and even with the engine surviving, oversized images remain pure
visual-token waste (VLMs are trained around ~2k px and downscale server-side
anyway). ADR-0025 explicitly parked client-side downscaling as a future
feature, leaving open whether the stored copy stays original.

## Decision

**A per-model longest-side pixel cap, enforced by downscaling in the renderer
— a transform at the door, not a rejection.**

- The cap is **model configuration**: `ModelConfig.imageMaxDim`, edited on the
  LLM card next to the other input capabilities, defaulting to
  `DEFAULT_IMAGE_MAX_DIM = 2048` when unset. It is the model's limit, so it
  lives with the model — not a global constant, not a tool parameter.
- **One helper, every door.** `lib/imageResize.ts` (canvas:
  `createImageBitmap` → `OffscreenCanvas`, same-mime re-encode) runs at the
  two places images enter: composer attachments (`readAttachments`) and the
  driver's tool-result hop — `LoadImage` reads files at full resolution in the
  main process and the image is fitted in the renderer on its way through,
  which also covers `GenerateImage` output. No image-processing code in
  Electron main (no `nativeImage` coupling, no native deps), and the tool's
  own contract is unchanged.
- **The downscaled copy is the only copy** — UI, persistence, resend window,
  and model all see the same fitted blob. This closes ADR-0025's open
  question: the stored copy does NOT stay original.
- **Best-effort, never blocking**: GIFs pass through untouched (canvas resize
  would keep only the first frame, and real GIFs don't come in oversized
  dimensions — the byte cap catches pathological ones), as do non-data URLs
  and anything that fails to decode.
- **Byte caps stop being model limits and become transport bounds.** Since the
  fitted copy is what reaches the transcript, storage, and the wire, checking
  the *original's* bytes against a model-sized cap measures the wrong object.
  One shared constants module (`lib/mediaCaps.ts`, imported by both doors so
  the numbers can't drift): resizable images get a 50 MB sanity bound — it
  only guards reading an insane file into memory and shipping it over IPC —
  while GIF keeps the strict 6 MB cap (nothing downstream shrinks it) and
  video stays at 50 MB per ADR-0025.
- **The resend window is retuned for fitted images** (amends ADR-0025's
  constants): `MAX_LIVE_MEDIA` 5 → 10 and `MAX_LIVE_MEDIA_BYTES` 8 → 50 MB.
  The original failure (multi-minute prefill) was pixel-driven, and pixels are
  now bounded by count × the per-model cap — so count becomes the binding
  budget, and the byte budget turns into a loose backstop against what the
  resizer can't shrink (GIFs, video, an image that didn't downscale much).
  50 also aligns the window with the 50 MB per-item ceiling: a smaller budget
  would let one limit silently kill another — a single legal max-size item
  overflowing the whole window, alive only via the newest-always exception.
- **The user is notified; the model is not.** The composer shows a transient
  "Downscaled to {max}px" note — the user chose the file, so the change is
  theirs to know about. Tool-loaded images carry no marker: the model never
  saw the original, so nothing was edited from its view (the llm-interfaces
  "announce context edits" rule does not apply), and the note would only spend
  tokens on something the model can't act on.

Alternatives rejected: enforcing in the `LoadImage` tool itself (main process
has no canvas; `nativeImage` couples host-agnostic tool code to Electron and
can't decode webp/gif; sharp adds a native dependency to packaging);
rejecting oversized images with their dimensions (a dead end for the user and
an extra round-trip for the model, when the fix is mechanical); a global
constant (the cap varies by model family).

## Consequences

- Visual-token cost per image is bounded regardless of source dimensions, and
  persisted media blobs shrink accordingly.
- Full resolution is unrecoverable downstream of the door — acceptable for a
  chat harness; a future fine-detail flow (e.g. region crops) would be a new
  tool, not a cap change.
- Multi-megabyte phone photos and dense screenshots now attach and load
  instead of bouncing off a 6 MB door — "too large to attach" survives only
  for what genuinely can't be helped (oversized GIFs, insane files).
- The cap rides `ModelConfig`, so sub-agents inherit it from their model card
  like every other model setting.
