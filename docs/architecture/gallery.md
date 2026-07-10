# Gallery (`core/gallery/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md). Decision:
[ADR-0081](../adr/0081-gallery-core-capability.md).

Content-agnostic page composition (a core capability, like the browser fleet): compose images into
a designed A4 page. The comic flow is one consumer; `GalleryCompose` works from any chat.

| File | Responsibility |
|------|----------------|
| `catalog.ts` | The layout catalog AS DATA: 26 user-reviewed layouts (4–8 panels), slot geometry `{x, y, w, aspect, rot?, clip?, cell?, z?, bleed?}`, hand-written descriptions, positional handles ("5-3"); `findLayout`, `supportedCounts` |
| `html.ts` | The page builder: masthead (auto-fit title, details lines, accent colors), slot rendering (die-cut cells, clips, tilts, halo), preview scaling (full-size layout under a scale transform) |
| `render.ts` | The RENDER PORT: core builds HTML, the host injects the renderer. One page format: A4 portrait 2100×2970 (10 px/mm) — no Letter variant (printers fit A4 themselves) |

The electron host implements the port with an offscreen `BrowserWindow`
(`enableLargerThanScreen`, temp-file `loadFile` — data: URLs exceed the URL cap — then
`capturePage`), see `electron/pageRender.ts`.

Tools: `GalleryOptions(count)` → previews + descriptions (text always rides for non-vision
models); `GalleryCompose({templateId, images, title, details, accent, name})` → the PNG (result
image + workspace save). The `gallery.system` capability block advertises the flow; the
"Gallery layouts" settings tab is the user's browser. Custom `<id>.html` layout drop-ins are
designed but deferred.
