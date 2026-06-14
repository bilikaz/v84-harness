# ADR-0034: Platform hosts (electron / web) over a host-agnostic core + shared renderer

Status: Accepted
Date: 2026-06-14

## Context

The dual-target build (ADR-0001) ran as "the renderer at the `src` root + `main/` +
`preload/`." Two smells grew on it: the renderer entry was `src/main.tsx`, clashing
with `src/main/` (the Electron *main process*); and platform-specific behaviour leaked
into `core` — the session driver branched `harness ? main : renderer` to run tools.
There was no folder to point at for "the web platform," which made the boundary hard
to even discuss. ADR-0003 said "host-agnostic core" but nothing enforced where the
host-specific wiring lived.

## Decision

Organise the app as **platform hosts over agnostic layers**:

- **`core/`** — host-agnostic domain logic. Never branches on platform; depends only
  on `ctx`.
- **`renderer/`** — the shared, platform-agnostic UI: the `App` and the boot
  (`main.tsx`). Loaded by *both* the browser and the Electron window. Depends only on
  `ctx`. The boot is the one exception (below).
- **`electron/`** — the Electron platform: the main process (window, IPC handlers,
  the tool dispatch `tools.ts`), the bridge contract (`bridge.ts`), the preload
  (`preload.ts`), and the renderer-side `init()` that forwards over the bridge
  (inline in `init.ts` — there is no separate gateway file). (Renamed from `main/`.)
- **`web/`** — the web platform: the in-process tool gateway, built in its `init()`.

`ctx` is the seam (ADR-0032): each platform builds and installs the parts that differ
— the tool gateway, storage, and host api. `core` and `renderer` consume `ctx` and stay
blind to the platform.

**The boot is the single place platform is detected** — `renderer/main.tsx`
dynamic-imports the chosen platform's `init()`:
`const { init } = "api" in window ? await import("../electron/init.ts") : await import("../web/init.ts")`,
then `await init()`. Each platform's `init()` builds the **whole** ctx — storage, the
tool gateway, and the host api — over the agnostic `Ctx` core. Everything downstream is
agnostic. (The composition root is allowed to know the host; nothing else is.)

Naming/build: `main/` → `electron/` (the Electron platform; the main *process* is one
part of it). `src/main.tsx` → `src/renderer/main.tsx`, ending the clash. electron-vite
points **both** the `main` build at `src/electron/index.ts` and the `preload` build at
`src/electron/preload.ts` explicitly (the preload moved into `electron/`, so there is no
`src/preload/`); the output keys (`out/main`, `out/preload`, `out/renderer`) are
unchanged, so `package.json` and the window's load paths don't move.

This refines ADR-0001 (dual-target) and ADR-0003 (host-agnostic core) — formalising the
platform hosts and the agnostic boundary between them.

## Consequences

- "Where does X live?" is answered by platform: Electron → `electron/`, web → `web/`,
  shared UI → `renderer/`, agnostic logic → `core/`.
- `core` + `renderer` are test-once / run-anywhere; platform code is small and isolated.
- The web build cannot reach Node-only code: `electron/`'s main process is a separate
  bundle, and the web gateway globs only the `general/` tools.
- A new platform is a new folder that builds its `ctx` (its `init()`) — touching nothing
  in `core/` or `renderer/`.
- The boot dynamic-imports only the chosen platform's `init()`, so the renderer bundle
  doesn't statically link both platforms — the unused platform's code splits into its own
  chunk that's never fetched. Platform selection lives in the composition root, where it
  belongs.
