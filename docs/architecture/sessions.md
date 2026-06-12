# Sessions engine (`core/sessions/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

The reference module shape for `core/` features:

| File | Responsibility |
|------|----------------|
| `store.ts` | State, selectors, mutations; decides WHEN to persist; the media resend window |
| `persistence.ts` | Granular durable IO: key scheme, media blob extract/reinflate, legacy migration |
| `driver.ts` | Orchestration: the turn loop (`sendTo` → `runTurn`), sub-agent execution, effective tool policy |
| `agentTools.ts` | The ListAgents/RunAgent pair: stable schemas, catalog text, name resolution (ADR-0022) |
| `events.ts` | Bus event interfaces + declaration merge + scoped bus |
| `listeners.ts` | Bus → store reactions (transcript building, streaming flags, persistence) |
| `hooks.ts` | React bindings only |
| `naming.ts`, `compaction.ts` | Self-contained background services |
| `index.ts` | Barrel export + side-effect imports that wire the services |

Small single-concern modules (`core/approvals.ts`, `core/workspaces.ts`) may stay
single-file **until** they gain side-effect services or listeners — then they split
into the folder shape above ([ADR-0003](../adr/0003-host-agnostic-core.md)).

## Turn loop highlights (`driver.ts`)

- Turns are addressable: `sendTo(sid, …)` runs a turn in a NAMED session and
  resolves with a `TurnResult { text, errored, aborted }` — the shared entry
  point under the composer (`send` targets the active session), manual agent
  runs (`runAgent`), and the RunAgent tool awaiting a sub-agent's answer.
- Per-session `AbortController` map for stop; stopping is not an error. Stop
  also cancels running tools (renderer tools via `ToolCtx.signal`; gated tools
  via the IPC cancel channel), denies the session's queued approvals, and
  cascades to sub-agent children —
  see [ADR-0014](../adr/0014-stop-semantics-and-tool-cancellation.md),
  [ADR-0013](../adr/0013-approval-promise-bridge.md) and
  [ADR-0022](../adr/0022-subagent-orchestration.md). Exhausting the step budget
  surfaces as a `turn:error`, never a silent stop.
- Tool loop: advertised tools = always-available renderer tools + the sub-agent
  pair (top-level sessions with a non-empty catalog only — depth 1) +
  workspace-gated bridge tools. The effective per-tool mode is
  `min(workspace policy, agent ceiling)` `0 | 1 | 2` (off / ask / auto)
  ([ADR-0023](../adr/0023-agent-definition-binding-and-ceiling.md)), with `ask`
  resolved through `core/approvals` (a Promise the ApprovalModal settles). Tools
  whose purpose is putting media in front of the model (LoadImage, LoadVideo) are
  additionally **capability-gated**: withheld from the advertised schemas — and
  refused at run time — when the model doesn't declare the matching input
  ([ADR-0018](../adr/0018-capability-gated-media-tools.md)).
- **Placement ≠ capability**
  ([ADR-0026](../adr/0026-agent-session-placement-vs-capability.md)):
  `session.workspaceId` only says where the session lives (sidebar group);
  agent runs always take the launch context's workspace (children: the
  parent's). What the session may touch is resolved per turn by
  `capabilityContext` — the live agent's ceiling, with the workspace masked
  out entirely for chat-only agents. `sessionToolModes` exposes the same
  computation to the UI; `unlinkAgent` (store) severs the link one-way,
  converting the session to plain workspace/chat permissions.
- Sub-agents: `ListAgents` returns the catalog as data; one
  `RunAgent {runs: […]}` call spawns all its child sessions concurrently and
  returns their combined answers; the ToolCard links to the live runs
  ([ADR-0022](../adr/0022-subagent-orchestration.md)). A worker's answer lives
  as a tool-result message in the PARENT's transcript — deleting child sessions
  (per-run, or all of a parent's via the right-panel cleanup button) costs only
  the child transcripts; mid-flight deletes stop the run first and the parent's
  RunAgent call settles as "stopped".
- When gated file tools are advertised, the `workspace.system` prompt asset is
  appended to the system message — the `/` virtual root (ADR-0007) is stated to
  the model, never assumed known.
- Validation failures (the generic `opts.validate` hook) trigger a bounded heal
  loop (hidden correction turns).
- Tool-produced media (generated or loaded) is fed back as a hidden user turn
  (`mediaFeedback`), filtered to what the model's declared inputs accept.
  Images are downscaled to the model's pixel cap (`imageMaxDim`, default 2048)
  as the result crosses the driver — UI, persistence, and model all share the
  fitted copy ([ADR-0027](../adr/0027-per-model-image-pixel-cap.md)).
- Resubmitted media rides a **resend window** (10 items / 50 MB, newest always
  sent — count is the binding budget now that images are pixel-fitted, bytes a
  loose backstop, ADR-0027): older media is swapped for an in-place stub
  naming what was there and how to re-load it
  ([ADR-0025](../adr/0025-media-resend-window.md)).
- The context meter (`usedTokens`) is a **snapshot** of the latest request's
  input + output — never a sum across requests (each request's input already
  counts the whole transcript). Auto-compaction summarizes the session when that
  snapshot crosses the context limit.
- **Message reference stability is a contract**: mutations replace only the
  objects they touch (streaming swaps the last message; appends keep the rest),
  and the transcript UI (`Message`/`Markdown`/`ToolCard`/`Thinking`) is
  memoized to bail by reference — a streamed token re-renders one message, not
  the transcript ([ADR-0019](../adr/0019-reference-stable-transcript.md)).
- **Persistence is granular and runs at turn completion**: the index (metas +
  activeId), each session's messages, and each media blob are separate keys in
  the durable tier — a turn's persist writes that session's text, a media blob
  is written once at creation, and boot reads the index + active session with
  the rest lazy-loading via `ensureLoaded`
  ([ADR-0021](../adr/0021-granular-session-persistence.md),
  [ADR-0020](../adr/0020-persist-at-turn-completion.md)). There is no localStorage
  cache; localStorage survives only as the port's last-resort backend.
