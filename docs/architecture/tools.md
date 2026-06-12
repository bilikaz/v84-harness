# Tool system (`core/tools/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0007](../adr/0007-tool-system.md))

- A tool is one file exporting one const: `export const <name>Tool: Tool =
  { schema, execute }`. Schemas are OpenAI function-tool format; each tool owns its
  schema inline. The contract (`ToolSchema`, `ToolResult`, `ToolCtx`, the tool
  vocabulary and policy constants) lives in `tools/types.ts`; `tools/shared.ts`
  holds only cross-cutting helpers.
- **Gated tools** (Read, List, Grep, Write, Edit, CreateFolder, Bash, LoadImage,
  LoadVideo) run in the Electron main process, dispatched by `execTool()` in
  `tools/index.ts`. They see a **virtual filesystem root**: `/` is the workspace
  root; `paths.ts` maps virtual ↔ real and enforces confinement (including symlink
  escape checks). LoadImage/LoadVideo are a factory-built pair in `loadMedia.ts`
  (one file — they differ only in whitelist, cap, and payload field) and are also
  capability-gated by the model's declared inputs
  ([ADR-0018](../adr/0018-capability-gated-media-tools.md)).
- **Permissionless tools** (GenerateImage, GenerateVideo) run in the renderer
  (`tools/renderer.ts`) and work in both web and Electron.
- **Driver-level tools** (ListAgents, RunAgent) are NOT in this registry: they
  spawn sessions, so they live in `core/sessions/` (`agentTools.ts` + the
  driver) and are dispatched before the registry paths
  ([ADR-0022](../adr/0022-subagent-orchestration.md)). They honor the same
  never-throw result contract.
- Tools **never throw**: every path returns `ToolResult { ok, output, … }`.
  The dispatcher catches everything and wraps it.
- Tool output is capped (line/byte limits) before it reaches the model. Media
  byte caps are **transport sanity bounds, not model limits**, with one source
  shared by the tools and composer attachments (`lib/mediaCaps.ts`): resizable
  images 50 MB, GIF 6 MB (the renderer can't downscale it — aligned with the
  resend window), video 50 MB
  ([ADR-0025](../adr/0025-media-resend-window.md),
  [ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
- LoadImage reads files at **full resolution** — pixel limits are not the
  tool's concern. Images are fitted to the model's longest-side cap
  (`ModelConfig.imageMaxDim`, default 2048) by `lib/imageResize.ts` on the
  driver's tool-result hop in the renderer, the same helper the composer runs
  on attachments ([ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
