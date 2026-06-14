# Tool system

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0007](../adr/0007-tool-system.md), [ADR-0033](../adr/0033-tools-registry-folder-by-permission.md),
[ADR-0032](../adr/0032-ctx-main-data-carrier.md), [ADR-0034](../adr/0034-platform-hosts-over-agnostic-core.md))

## `core/tools/` — host-agnostic building blocks

- A tool is a **class** extending `BaseTool` (one file, canonical export), constructed
  per call with `(ctx, cwd, signal)`. `schema` is a getter (advertised shape can depend
  on the ctx), `run(args)` does the work. Three cheap per-tool checks: `canRun()`
  (capability), `isPermissioned()` (is it gated? `BaseWorkspaceTool` → `true`), and
  `defaultPermission()` (default policy mode; `Bash` → ask, rest → allow). `OUTPUT_CAP` /
  `cap()` live in `tools/base.ts`; the vocabulary in `tools/types.ts`.
- **`factory.ts`** is the registry engine: a folder of eager-globbed modules → resolve
  (find → `canRun` → parse → run). It knows nothing of who calls it.
- **The folder is the permission tier** — no static `ALL_TOOLS`/`DEFAULT_TOOL_POLICY`:
  - **`general/`** — permissionless (`ImageGenerate`, `VideoGenerate`): no workspace, no
    gate; `canRun()` only. Host-agnostic (provider HTTP + data-URLs).
  - **`workspace/`** — gated by the per-workspace policy (`0|1|2`): `Read`, `List`,
    `Grep`, `Write`, `Edit`, `CreateFolder`, `Bash`, `ImageLoad`, `VideoLoad`,
    `ImageDescribe`, `VideoDescribe`. Need Node (fs/shell).
- **The gated-tool list is dynamic**: it's the tools that report `isPermissioned()`,
  surfaced as `ToolDescriptor`s and cached in `permissions.ts`. The settings UIs render
  that list; the driver's policy math (`effectiveMode`/`sessionToolModes`) reads it.
  Workspace/agent policies are partial maps — a missing entry falls back to the tool's
  `defaultPermission()`.

## Execution lives in the platform, via `ctx.tools`

`core` and the driver never run a tool directly or branch on platform — they call the
gateway on the ctx (`ctx.tools.{schemas,run,descriptors}`, ADR-0032). Each platform
installs its gateway at boot (ADR-0034):

- **web** (`web/tools.ts`) — runs `general/` **in-process** through the factory; the
  Node-only gated tools don't exist in the web bundle.
- **electron** — the renderer-side gateway (`electron/gateway.ts`) ships the call over
  the bridge as `ToolWire { cwd, config }`; the main process (`electron/tools.ts`) runs
  `general/` + `workspace/` through the same factory, rebuilding a `Ctx` from the wire
  (the client and signal can't cross IPC, so main re-mints them). Cancel is a separate
  `tools:cancel` IPC ([ADR-0014](../adr/0014-stop-semantics-and-tool-cancellation.md)).

So a tool call flows: driver → `ctx.tools.run(...)` → (web) in-process or (electron)
bridge → main. The driver only knows the gateway.

## Talking to models

A tool calls `this.llm.call({service: "imageRec", …})` (`this.llm` is `this.ctx.llm`)
and never sees connection details ([llm.md](llm.md)). Domain params (`promptStyle`,
size caps) ride the resolved `ConfigLLM.model`.

## Virtual filesystem root

The model sees `/workspace` as the root. `workspace/base.ts` maps virtual ↔ real and
enforces confinement (leading-slash paths outside `/workspace` are refused; symlink-escape
checks); `expandWorkspace` expands the marker in shell commands and `hideRoot` hides the
real root in output. `ImageLoad`/`VideoLoad`/`ImageDescribe`/`VideoDescribe` share the
file guards in `workspace/mediaFile.ts`, capability-gated by the model's declared inputs
([ADR-0018](../adr/0018-capability-gated-media-tools.md)).

## Contracts & caps

- **Driver-level tools** (ListAgents, RunAgent) are NOT in this registry: they spawn
  sessions, so they live in `core/sessions/` and dispatch before the registry paths
  ([ADR-0022](../adr/0022-subagent-orchestration.md)). Same never-throw contract.
- Tools **never throw**: every path returns `ToolResult { ok, output, … }`.
- Output is capped before it reaches the model. Media byte caps are **transport sanity
  bounds, not model limits**, one source shared with composer attachments
  (`lib/mediaCaps.ts`): resizable images 50 MB, GIF 6 MB, video 50 MB
  ([ADR-0025](../adr/0025-media-resend-window.md), [ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
- `ImageLoad` reads at **full resolution**; images are fitted to the model's longest-side
  cap (`MainSettings.imageMaxDim`, default 2048) by `lib/imageResize.ts` on the driver's
  tool-result hop in the renderer ([ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
