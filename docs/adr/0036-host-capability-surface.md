# ADR-0036: Host capability surface — `ctx.api`, platform-injected, gated on presence

Status: Proposed
Date: 2026-06-14

## Context

Agnostic code (`core/`, `renderer/`, `lib/`) still reached the desktop directly.
`lib/harness.ts` exported the bridge handle (`harness`) and an `isElectron()` test,
and otherwise-agnostic modules branched on it: the media model fetch chose
main-side IPC vs a browser fetch, the save-image/save-video paths chose a native
dialog vs an `<a download>`, the folder picker assumed a native dialog. Each was a
platform `if` smuggled into a layer that ADR-0034 says must stay blind to the host —
the same smell the tool gateway (ADR-0032/0034) had already been cured of, left
untreated for the remaining host services.

## Decision

A **`HostApi`** interface (`core/host.ts`) of OPTIONAL methods, carried on `ctx.api`,
populated by each platform's `init()`:

```ts
// core/host.ts
interface HostApi {
  pickFolder?(): Promise<string | null>;
  saveImage?(dataUrl: string, suggestedName?: string): Promise<string | null>;
  saveVideo?(dataUrl: string, suggestedName?: string): Promise<string | null>;
  mediaModels?(endpoint: MediaEndpoint): Promise<MediaModelsResult>;
}
```

- **Each platform supplies what it can.** `web/init.ts` backs it with browser
  behaviour — `saveImage`/`saveVideo` download via a synthesized `<a>`, `mediaModels`
  does a direct `fetch(`…/models`)` — and OMITS `pickFolder` (the browser has no
  native folder picker). `electron/init.ts` backs every method with the bridge
  (`window.api.pickFolder`, `…saveImage`, `…media.models`, which runs in main, no
  CORS).
- **Agnostic callers gate on presence.** Method present → use it; absent →
  unsupported. `Sidebar.tsx` does `ctx.api.pickFolder ? await ctx.api.pickFolder() : …`;
  `lib/saveMedia.ts` calls `ctx.api.saveImage?.(…)`; `core/media.ts` calls
  `ctx.api.mediaModels?.(provider)`. No layer asks *which* host it's on — only whether
  the capability exists.
- **The bridge is platform-private.** `lib/harness.ts` is deleted. The bridge
  contract (`electron/bridge.ts` — `window.api`, `ElectronApi`; ADR-0002) is imported
  only by `electron/` and `preload/`. The boot detects the platform inline,
  `renderer/main.tsx`: `const { init } = "api" in window ? import("electron/init") :
  import("web/init")` — no `isElectron()` in agnostic code (the composition root knows
  the host; ADR-0034).

This is the tool-gateway injection of ADR-0032/0034 generalised to host services:
the platform fills the parts that must differ, `core`/`renderer` consume one carrier
(`ctx`) and stay agnostic. `ctx.tools` is the execution seam; `ctx.api` is the host
services seam; `ctx.storage` (ADR-0035) is the persistence seam.

## Consequences

- Agnostic layers never import the bridge and never branch on platform — the host
  `if`s are gone from `core`/`renderer`/`lib`.
- Adding a host capability is mechanical: a new optional method on `HostApi`, plus
  each platform's impl (and the browser omits what it can't do). Callers that already
  gate on presence need no change to stay safe on a host that lacks it.
- The capability vocabulary lives with the surface: `MediaEndpoint` and
  `MediaModelsResult` are defined in `core/host.ts` and re-exported by the bridge, so
  the agnostic caller and the bridge agree on the shape without the caller importing
  the bridge.
- Symmetry with the gateway makes the seam easy to reason about — three injected
  members (`tools`, `api`, `storage`), each built by the platform, each consumed
  blind. A new platform fills all three and touches nothing agnostic.
