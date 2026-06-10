# ADR-0007: Tool system — self-contained tools, gated vs permissionless, virtual root

Status: accepted
Date: 2026-06-10 (documented retroactively)

## Context

Agent tool calls touch the local filesystem and spawn processes — the most
dangerous surface in the app. Tools must be safe by construction, work across the
web/Electron split, and be governed per workspace.

## Decision

- **Definition pattern**: one tool per file, exporting one const —
  `export const <name>Tool: Tool = { schema, execute }`. The schema (OpenAI
  function-tool format) lives inline with the implementation.
- **Two classes**:
  - *Gated tools* (Read, List, Grep, Write, Edit, CreateFolder, Bash) execute in
    the Electron main process via `execTool()` (`tools/index.ts`), reached from
    the renderer through `harness.tools.exec`.
  - *Permissionless tools* (GenerateImage, GenerateVideo) execute in the renderer
    (`tools/renderer.ts`) and work in both targets; they touch no local state.
- **Virtual root**: gated tools see `/` as the workspace root. `paths.ts` maps
  virtual ↔ real, rejects escapes, and resolves symlinks so a link cannot point
  outside the workspace.
- **Permission model**: per-workspace, per-tool mode `0 | 1 | 2`
  (off / ask / auto). `ask` suspends the driver on a Promise from
  `core/approvals` until the ApprovalModal resolves it. Permissionless tools are
  always mode 2.
- **Never throw**: every tool path returns `ToolResult { ok, output, … }`; the
  dispatcher catches anything that escapes and wraps it with a descriptive
  message. Output is capped (lines/bytes) before reaching the model.
- Grep runs argv-style (no shell interpolation); Bash output is scrubbed and the
  process runs with the workspace as cwd.

## Consequences

- Adding a tool = one file + registration in the dispatcher array (and, if
  gated, a workspace policy entry). Schema and behavior cannot drift apart.
- The model always gets a well-formed tool result, so a tool bug degrades into a
  visible error message in the transcript instead of a crashed turn.
- Confinement is enforced at the path layer, not per-tool — new gated tools get
  it for free by using `paths.ts`.
