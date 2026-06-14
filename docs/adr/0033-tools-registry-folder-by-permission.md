# ADR-0033: Tools — host-agnostic registry, dynamic permission tiers, per-platform execution

Status: Accepted
Date: 2026-06-14

## Context

The tool set was a flat `core/tools/*.ts` with a single main-process dispatcher, a
static `ALL_TOOLS` / `DEFAULT_TOOL_POLICY` list, and host-coupled execution baked
into the session driver (a `harness ? main : renderer` branch). Three problems:
the permission tier of a tool was implicit, the gated-tool list was hand-maintained
and could drift, and `core` knew which platform it ran on.

## Decision

**`core/tools/` is host-agnostic** — the building blocks only:

- `registry.ts` — the registry engine, the class `ToolRegistry`: a folder of
  eager-globbed modules → resolve (find → `canRun` → parse → run). Knows nothing of
  who calls it.
- `general/` + `workspace/` — the tool classes, grouped by **permission tier**.
- `types.ts`, `base.ts`. No platform refs.

**Tools are classes discovered dynamically; no static list.** Each tool is
constructed with only the `LLMClient` (`new Ctor(llm)`, `BaseTool(llm)`); the client
is its sole host dependency. Each `BaseTool` answers cheap per-tool questions:

- `canRun()` — capability (configured slot / model input).
- `isPermissioned()` — is it gated? `BaseWorkspaceTool` overrides → `true`.
- `needsWorkspace()` — does it require a workspace folder? Forced off when none is in
  context. A separate axis from `isPermissioned()` — a tool can need a workspace
  without being gated.
- `defaultPermission()` — its default policy mode (`Bash` → ask, rest → allow).

These replace `ALL_TOOLS` / `DEFAULT_TOOL_POLICY`. The gated-tool list **is** the
tools that report `isPermissioned()`, surfaced as `ToolFilterEntry`s by the registry's
`filter()` and cached on the renderer
([renderer/gatedTools.ts](../../apps/desktop/src/renderer/gatedTools.ts) —
`useGatedTools()` calling `ctx.tools.filter({ includeDisabled: true })`); the settings
UIs render that list. `effectiveMode` is computed inside `filter()` (in the registry),
not by the driver. Workspace/agent policies are partial maps — a missing entry falls
back to the tool's `defaultPermission()`.

**The folder is the permission tier** (ADR-0007's gated/permissionless split made
structural):

- `general/` — permissionless (`ImageGenerate`, `VideoGenerate`): no workspace, no
  gate. Host-agnostic (HTTP + data-URLs).
- `workspace/` — gated (`Read`/`Write`/`Bash`/… + the media load/describe tools):
  per-workspace policy `0|1|2`. Need Node (fs/shell), so they exist only in the
  Electron main bundle; the web build never references them.

**Execution belongs to the platform, via `ctx.tools`** (ADR-0032): the web gateway
runs `general` in-process; the electron gateway ships the call over the bridge
(`WireConfig { config }`; cwd rides on the `ToolCallRequest`) to main, which runs
`general` + `workspace` through the same `ToolRegistry`. The driver only ever calls
`ctx.tools.{filter,run,cancel}` — never a platform.

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
- One registry serves both platforms, so the find/gate/parse/run sequence can't drift.
- The settings tool list is dynamic; a tool added/removed shows up without editing a
  central list.
- The registry still excludes base classes by **filename** (only `/base.ts`) — a
  future base with another name would be wrongly instantiated (noted, not yet a problem).
