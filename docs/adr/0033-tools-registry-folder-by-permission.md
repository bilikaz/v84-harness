# ADR-0033: Tools — host-agnostic registry, dynamic permission tiers, per-platform execution

Status: Proposed
Date: 2026-06-14

## Context

The tool set was a flat `core/tools/*.ts` with a single main-process dispatcher, a
static `ALL_TOOLS` / `DEFAULT_TOOL_POLICY` list, and host-coupled execution baked
into the session driver (a `harness ? main : renderer` branch). Three problems:
the permission tier of a tool was implicit, the gated-tool list was hand-maintained
and could drift, and `core` knew which platform it ran on.

## Decision

**`core/tools/` is host-agnostic** — the building blocks only:

- `factory.ts` — the registry engine: a folder of eager-globbed modules → resolve
  (find → `canRun` → parse → run). Knows nothing of who calls it.
- `general/` + `workspace/` — the tool classes, grouped by **permission tier**.
- `types.ts`, `base.ts`, `permissions.ts` (a pure renderer cache). No platform refs.

**Tools are classes discovered dynamically; no static list.** Each `BaseTool`
answers cheap per-tool questions:

- `canRun()` — capability (configured slot / model input).
- `isPermissioned()` — is it gated? `BaseWorkspaceTool` overrides → `true`.
- `defaultPermission()` — its default policy mode (`Bash` → ask, rest → allow).

These replace `ALL_TOOLS` / `DEFAULT_TOOL_POLICY`. The gated-tool list **is** the
tools that report `isPermissioned()`, surfaced as `ToolDescriptor`s and cached
([permissions.ts](../../apps/desktop/src/core/tools/permissions.ts)); the settings
UIs render that list, the driver's policy math reads it. Workspace/agent policies
are partial maps — a missing entry falls back to the tool's `defaultPermission()`.

**The folder is the permission tier** (ADR-0007's gated/permissionless split made
structural):

- `general/` — permissionless (`ImageGenerate`, `VideoGenerate`): no workspace, no
  gate. Host-agnostic (HTTP + data-URLs).
- `workspace/` — gated (`Read`/`Write`/`Bash`/… + the media load/describe tools):
  per-workspace policy `0|1|2`. Need Node (fs/shell), so they exist only in the
  Electron main bundle; the web build never references them.

**Execution belongs to the platform, via `ctx.tools`** (ADR-0032): the web gateway
runs `general` in-process; the electron gateway ships the call over the bridge
(`ToolWire { cwd, config }`) to main, which runs `general` + `workspace` through the
same `factory`. The driver only ever calls `ctx.tools.{schemas,run,descriptors}` —
never a platform.

Folded in: virtual root `/` → `/workspace` (refines ADR-0007; `paths.ts` →
`workspace/base.ts`, adding `expandWorkspace`/`hideRoot`); media tool renames
`LoadImage`/`LoadVideo` → `ImageLoad`/`VideoLoad` (+ `ImageDescribe`/`VideoDescribe`,
refines ADR-0018).

This **supersedes ADR-0007's virtual-root marker and single-registry clauses**; its
gated/permissionless tiers and never-throw contract stand.

## Consequences

- Adding a tool = dropping a file in the right tier folder; the registry finds it,
  and its folder declares its permission tier.
- The web build is correct by construction — its gateway only globs `general/`, so
  the Node-only gated tools are never bundled.
- One factory serves both platforms, so the find/gate/parse/run sequence can't drift.
- The settings tool list is dynamic; a tool added/removed shows up without editing a
  central list.
- The factory still excludes base classes by **filename** (`base`, `mediaFile`) — a
  future base with another name would be wrongly instantiated (noted, not yet a problem).
