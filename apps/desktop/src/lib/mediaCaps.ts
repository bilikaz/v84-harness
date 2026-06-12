// Media byte caps — the ONE source for both media doors: composer
// attachments (lib/attachments.ts) and the LoadImage/LoadVideo tools
// (core/tools/loadMedia.ts, imported by Electron main), so the numbers can't
// drift. Dependency-free for the same reason dataUrl.ts is.
//
// These are TRANSPORT bounds, not model limits — the model check for images
// is dimensions (ModelConfig.imageMaxDim, fitted in the renderer; ADR-0027).
// Resizable images get a generous sanity cap: it only guards reading an
// insane file into memory and shipping it over IPC — right after, the
// renderer downscales it, so the original's bytes never reach the
// transcript, storage, or the wire.
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
// GIF is the one image format the resizer passes through (canvas would drop
// the animation), so bytes are its only guard — kept strict so a handful of
// GIFs can't dominate the request body.
export const GIF_MAX_BYTES = 6 * 1024 * 1024;
// Video is never resized: a rare, single-item operation that the window's
// newest-always rule delivers once and then retires (ADR-0025).
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
