# ADR-0034: Platform hosts (electron / web) over a host-agnostic core + shared renderer

Status: Proposed
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
  the tool dispatch `tools.ts`) **and** the renderer-side bridge gateway
  (`gateway.ts`). (Renamed from `main/`.)
- **`web/`** — the web platform: the in-process tool gateway.
- **`preload/`** — the Electron bridge (unchanged).

`ctx` is the seam (ADR-0032): each platform builds and installs the parts that differ
— in practice, the tool gateway. `core` and `renderer` consume `ctx` and stay blind to
the platform.

**The boot is the single place platform is detected** —
`renderer/main.tsx` runs one line: `ctx.tools = harness ? electronTools : webTools`.
Everything downstream is agnostic. (The composition root is allowed to know the host;
nothing else is.)

Naming/build: `main/` → `electron/` (the Electron platform; the main *process* is one
part of it). `src/main.tsx` → `src/renderer/main.tsx`, ending the clash. electron-vite's
`main` build points explicitly at `src/electron/index.ts`; the output keys
(`out/main`, `out/preload`, `out/renderer`) are unchanged, so `package.json` and the
window's load paths don't move.

This refines ADR-0001 (dual-target) and ADR-0003 (host-agnostic core) — formalising the
platform hosts and the agnostic boundary between them.

## Consequences

- "Where does X live?" is answered by platform: Electron → `electron/`, web → `web/`,
  shared UI → `renderer/`, agnostic logic → `core/`.
- `core` + `renderer` are test-once / run-anywhere; platform code is small and isolated.
- The web build cannot reach Node-only code: `electron/`'s main process is a separate
  bundle, and the web gateway globs only the `general/` tools.
- A new platform is a new folder that builds its `ctx` (its gateway) — touching nothing
  in `core/` or `renderer/`.
- One soft spot: `renderer/main.tsx` (the boot) imports both platform gateways to pick
  one. It's the composition root, so that's where platform selection belongs — but it
  does mean the renderer bundle links both gateways (both are Node-free, so this is
  bundle-size, not correctness).
