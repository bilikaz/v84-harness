# Tool system

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0007](../adr/0007-tool-system.md), [ADR-0033](../adr/0033-tools-registry-folder-by-permission.md),
[ADR-0032](../adr/0032-ctx-main-data-carrier.md), [ADR-0034](../adr/0034-platform-hosts-over-agnostic-core.md))

## `core/tools/` — host-agnostic building blocks

- A tool is a **class** extending `BaseTool` (one file, canonical export), constructed
  **once** with just the LLM client (`new Ctor(llm)`) — its only host dependency. `schema`
  is a getter, `run(args, cwd?, signal?)` does the work and takes the cwd + signal per call
  (the tool holds no ctx). Four cheap per-tool checks: `canRun()` (capability),
  `isPermissioned()` (is it gated? `BaseWorkspaceTool` → `true`), `needsWorkspace()`
  (requires a workspace folder; `BaseWorkspaceTool` → `true`), and `defaultPermission()`
  (default policy mode; `Bash` → ask, rest → allow). `OUTPUT_CAP` / `cap()` live in
  `tools/base.ts`; the vocabulary in `tools/types.ts`.
- **`registry.ts`** (`ToolRegistry`) is the registry engine: a folder of eager-globbed
  modules → pre-instantiated tools by name → resolve (find → `canRun` → parse → run). It
  knows nothing of who calls it.
- **The folder is the permission tier**:
  - **`general/`** — permissionless (`ImageGenerate`, `VideoGenerate`): no workspace, no
    gate; `canRun()` only. Host-agnostic (provider HTTP + data-URLs).
  - **`workspace/`** — gated by the per-workspace policy (`0|1|2`): `Read`, `List`,
    `Grep`, `Write`, `Edit`, `CreateFolder`, `Bash`, `ImageLoad`, `VideoLoad`,
    `ImageDescribe`, `VideoDescribe`. Need Node (fs/shell).
  - **`account/`** — the memory tools (`SaveMemory`, `SearchMemory`, `GetMemory`,
    `EditMemory`, `DeleteMemory`): permissionless, but `canRun()` gates them on a
    **connected account** (`BaseAccountTool` → `isConnected()`). They call the
    knowledge API via `authedFetch`, so they must run where the token lives — the
    **renderer**, never main (see the execution note below;
    [ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md),
    [knowledge.md](knowledge.md)).
- **The gated-tool list is dynamic**: it's the tools that report `isPermissioned()`. The
  renderer reads it through `renderer/gatedTools.ts` (`useGatedTools()`), which calls
  `ctx.tools.filter({ includeDisabled: true })` and keeps the permissioned `ToolFilterEntry`s
  (`schema`, `permissioned`, `needsWorkspace`, `defaultMode`, `effectiveMode` — see
  `tools/types.ts`). `effectiveMode` is computed inside `filter()` (in `registry.ts`):
  workspace/agent policies are partial maps (stricter of grant and ceiling wins), a missing
  entry falls back to the tool's `defaultPermission()`, and a `needsWorkspace` tool is forced
  to mode 0 when no workspace is in context.

## Execution lives in the platform, via `ctx.tools`

`core` and the driver never run a tool directly or branch on platform — they call the
gateway on the ctx (`ctx.tools.{filter,run,cancel}`, ADR-0032). Each platform installs
its gateway at boot (ADR-0034):

- **web** — runs `general/` + `account/` **in-process** in the renderer; the registry is
  built inline in `web/init.ts` (no separate tools file), and the Node-only gated tools
  don't exist in the web bundle.
- **electron** — workspace/fs tools run in MAIN (they need `node:fs`, unreachable under
  contextIsolation). The renderer's `ctx.tools` (`electron/init.ts`) forwards
  `filter`/`run`/`cancel` to `api.tools.*` over the bridge; the wire is `WireConfig { config }`
  (just the config snapshot — `cwd` rides on the `ToolCallRequest`). The main-side
  `ToolRegistry` over `general/` + `workspace/`, plus a config-seeded LLM client
  (`createClient(resolver)`), lives in `electron/tools.ts`, which re-seeds its module-level
  `config` from the wire on each call; `electron/ipc.ts` wires the handlers. Cancel is a
  separate `tools:cancel` IPC ([ADR-0014](../adr/0014-stop-semantics-and-tool-cancellation.md)).
- **`account/` is the exception that stays in the renderer on BOTH platforms.** Electron
  builds a second in-process `ToolRegistry` over `account/*` and MERGES it with the bridge:
  `filter` spreads `{ ...(await mainFilter), ...accountReg.filter }`, and `run` routes by
  `accountReg.byName.has(call.name)` (renderer) vs. the bridge (main). This keeps
  `authedFetch` — the account token + refresh — in the renderer, so it never crosses IPC
  ([ADR-0039](../adr/0039-account-local-store-and-connection-lifecycle.md)).

So a tool call flows: driver → `ctx.tools.run(...)` → in-process (web, or electron's
`account/` tier) or over the bridge → main (electron `general/`+`workspace/`). The driver
only knows the gateway. Cancellation travels by call id (`cancel(callId)`) — the registry
owns the `AbortController`, since a live `AbortSignal` can't cross the bridge.

## Talking to models

A tool calls `this.llm.call({service: "imageRec", …})` — `this.llm` is the injected
`LLMClient` directly — and never sees connection details ([llm.md](llm.md)). A tool checks
its slot via `this.llm.resolve(service)`, which returns the resolved model target
(`LLMConfig`) or `null`; domain params (`promptStyle`, size caps) ride that
`LLMConfig.model`.

## Virtual filesystem root

The model sees `/workspace` as the root. `workspace/base.ts` maps virtual ↔ real and
enforces confinement (leading-slash paths outside `/workspace` are refused; symlink-escape
checks); `expandWorkspace` expands the marker in shell commands and `hideRoot` hides the
real root in output. `ImageLoad`/`VideoLoad`/`ImageDescribe`/`VideoDescribe` share the
file guards in `workspace/base.ts` and are capability-gated via `canRun()`
([ADR-0018](../adr/0018-capability-gated-media-tools.md)) — but on different signals:
`ImageLoad`/`VideoLoad` gate on the **main model's** declared inputs (`resolve("main").input.image/.video`),
since they put media in the chat model's context; `ImageDescribe`/`VideoDescribe` gate
on a configured **recognition service** (`resolve("imageRec"/"videoRec")`), since they
hand the main model only text. The gate is enforced at advertise time (the schema filter
drops it) and again per call, and the permission card hides what `canRun()` rejects.

## Contracts & caps

- **Driver-level tools** (ListAgents, RunAgent) are NOT in this registry: they spawn
  sessions, so they live in `core/sessions/` and dispatch before the registry paths
  ([ADR-0022](../adr/0022-subagent-orchestration.md)). Same never-throw contract.
- Tools **never throw**: every path returns `ToolResult { ok, output, … }`.
- Output is capped before it reaches the model. Media byte caps are **transport sanity
  bounds, not model limits**, one source shared with composer attachments — the `media`
  block in `core/config/defaults.ts`, consumed via config: resizable images 50 MB, GIF
  6 MB, video 50 MB
  ([ADR-0025](../adr/0025-media-resend-window.md), [ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
- `ImageLoad` reads at **full resolution**; images are fitted to the model's longest-side
  cap (`effectiveImageMaxDim` resolves the model card's value against `config.app.media`,
  default 2048) by `lib/imageResize.ts` on the driver's tool-result hop in the renderer
  ([ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
