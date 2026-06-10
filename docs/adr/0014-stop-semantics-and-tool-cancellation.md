# ADR-0014: Stop semantics and tool cancellation across the IPC bridge

Status: accepted
Date: 2026-06-10

## Context

Stop originally aborted only the model stream. Tools kept running: a Bash child
process in main ran to its timeout, and GenerateVideo's poll loop ran up to 30
minutes after the user pressed Stop — hanging connections and wasted GPU work.
The obvious fix — threading the turn's `AbortSignal` into tools — fails at the
process boundary: **an AbortSignal is not structured-cloneable and cannot cross
IPC.**

## Decision

One turn = one `AbortController` per session (`inflight` map in the driver).
Stop (`stopTurn`) aborts it, denies queued approvals (ADR-0013), and is a clean
exit, never a `turn:error`. Cancellation then propagates per tool class:

- **Renderer tools** (GenerateImage/GenerateVideo) receive the turn's signal
  directly via `ToolCtx.signal`: it cancels the upsampling LLM call, all
  fetches, and the video poll loop.
- **Gated tools** (main process) get a **cancel channel**: the renderer never
  sends the signal; instead `execTool` in main mints its own `AbortController`
  per call id (a `running` map), and the driver sends `IPC tools:cancel`
  with the call id on abort. Main aborts its controller; Bash/Grep kill their
  child processes (`SIGKILL`), reporting `[exit: cancelled by the user]`.
  The preload strips `signal` from the wire ctx defensively.
- `ToolCtx.signal` is therefore **process-local by contract** — each side mints
  or forwards its own; it never serializes.
- Quick fs ops (Read/Write/Edit/List/CreateFolder) may ignore the signal;
  long-running tools must respect it.

**Known limitation:** cancelling GenerateVideo stops the *polling*; the server
job keeps running (the endpoint has no cancel API). Job-id persistence for
resume/cleanup is future work — tracked in [docs/adr/README.md](README.md).

## Consequences

- Stop now actually stops: stream, LLM sub-calls, child processes, and poll
  loops all end; nothing holds a connection past the user's intent.
- Tool authors get one rule: long-running work checks `ctx.signal`.
- `tools.cancel` resolving means *delivered*, not *exited* — the tool's own
  result (with the cancelled marker) is still the source of truth.
