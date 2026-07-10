# ADR-0081: The gallery is a core capability — layouts as data, one A4 page format

Status: Accepted
Date: 2026-07-09
Present-tense map: [architecture/gallery.md](../architecture/gallery.md).

## Context

The comics plugin needed multi-image page composition (panel layouts, masthead, print-quality
output). Building it inside the plugin would have buried a general capability: composing images
into a designed page is content-agnostic (photo collages, postcards) — the comic is one consumer.

## Decision

**Page composition is core** (`core/gallery/`), like the browser fleet:

- **Layouts are DATA, self-described**: a hand-curated catalog (26 user-reviewed layouts, 4–8
  panels) of slot geometry (`{x, y, w, aspect, rot?, clip?, cell?, z?, bleed?}`) + a hand-written
  description + a preview — no generation at runtime. Handles are positional (`"5-3"`); supported
  counts derive from the catalog. Review-settled style rules: spacing is king; one wild layout per
  count; floating insets banned; die-cut cells; collide seams.
- **ONE page format: A4 portrait at 2100×2970 (10 px/mm).** No Letter variant, no size selector —
  printers fit/margin A4 output themselves; a page-size knob is confusion, not capability.
- **Rendering is a PORT**: core builds the page HTML; the electron host injects the renderer (an
  offscreen `BrowserWindow`, `enableLargerThanScreen`, temp-file `loadFile`, `capturePage`).
  Small previews reuse the full-size layout under a scale transform.
- **Two tools**: `GalleryOptions(count)` → previews + descriptions (text always rides, for
  non-vision models); `GalleryCompose({templateId, images, title, details, accent})` → the PNG,
  returned as a result image and saved to the workspace. A `gallery.system` capability block
  advertises the flow when the tools are live; a "Gallery layouts" settings tab is the user's
  browser.

*Deferred by design:* custom layout drop-ins (`<id>.html` + meta + preview sibling — the folder is
the registry), a manual creation wizard, non-A4 tuned variants (the engine already parameterizes
size).

## Consequences

- The comic flow consumes `GalleryCompose` like any caller; layout geometry lives in exactly one
  place and is user-browsable.
- Adding a layout is a data change (or, later, a file drop) — never engine work.
