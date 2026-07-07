# Sessions engine (`core/sessions/`)

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).

The reference module shape for `core/` features:

| File | Responsibility |
|------|----------------|
| `store.ts` | State, selectors, mutations; decides WHEN to persist; the media resend window |
| `persistence.ts` | Pure session-meta shapes: `SessionMeta`/`SessionsIndex` + the `toMeta`/`normalize` coercions (durable IO lives in `StorageEngine`, [architecture/storage.md](storage.md)) |
| `engine.ts` | The `SessionEngine` class — orchestration: the turn loop (`sendTo` → `runTurn`), sub-agent execution + delivery (`awaitSettled`, the async push queue), boot `reconcile()` (restart recovery, [ADR-0073](../adr/0073-subagent-restart-recovery.md)), effective tool policy, naming/compaction wiring |
| `events.ts` | Bus event interfaces + declaration merge + scoped bus |
| `listeners.ts` | Bus → store reactions (transcript building, streaming flags, persistence) |
| `hooks.ts` | React bindings only |
| `naming.ts`, `compaction.ts` | Self-contained background services |
| `index.ts` | Barrel export + side-effect imports that wire the services |

Small single-concern modules (`core/approvals.ts`, `core/workspaces.ts`) may stay
single-file **until** they gain side-effect services or listeners — then they split
into the folder shape above ([ADR-0003](../adr/0003-host-agnostic-core.md)).

## Turn loop highlights (`engine.ts`)

The `SessionEngine` is constructed in the `Ctx` constructor (`core/ctx.ts`)
and carried on `ctx.sessions`; the renderer reaches it via `useCtx().sessions`
(`renderer/ctx.tsx`). Its constructor injects the host's storage into the store
(`useStorage`) and triggers `hydrate()`, then wires the naming/compaction bus
subscribers. The public turn methods (`send`, `sendTo`, `runAgent`, `stopTurn`,
`compact`, `deleteSession`, `sessionToolModes`) are `SessionEngine` methods.

- Turns are addressable: `sendTo(sid, …)` runs a turn in a NAMED session and
  resolves with a `TurnResult { text, errored, aborted }` — the shared entry
  point under the composer (`send` targets the active session), manual agent
  runs (`runAgent`), and the RunAgent tool awaiting a sub-agent's answer.
  Callers pass no config: the engine resolves `main` itself (`resolveMain`)
  for capability math, and each step is one
  `this.ctx.llm.call({service: "main", tools, handler: chatStepHandler(…)})` —
  the handler streams events onto the bus and returns `{text, thinking, calls}`;
  the tool-execution cycle stays here, not in the llm layer
  ([architecture/llm.md](llm.md)).
- Per-session `AbortController` map for stop; stopping is not an error. Stop
  also cancels the running tool via `ctx.tools.cancel(call.id)` — a live signal
  can't cross the bridge, so in electron this routes through `api.tools.cancel`
  to the `harness:tools:cancel` IPC channel and the registry (which owns the
  AbortController) aborts it. Stop also denies the session's queued approvals,
  and cascades to sub-agent children —
  see [ADR-0014](../adr/0014-stop-semantics-and-tool-cancellation.md),
  [ADR-0013](../adr/0013-approval-promise-bridge.md) and
  [ADR-0022](../adr/0022-subagent-orchestration.md). Exhausting the step budget
  surfaces as a `turn:error`, never a silent stop.
- Tool loop: a single
  `ctx.tools.filter({ checkCanRun, hasWorkspace, workspacePermissions, agentPermissions })`
  pass returns both the advertised tool schemas AND each tool's effective mode
  in one shot; the sub-agent pair (`ListAgents`/`RunAgent`) is engine-level
  (top-level sessions only — depth 1) and joins via `agentToolSchemas(!!ws)`.
  The per-call mode check reads from that same filter result. The effective
  per-tool mode is `min(workspace policy, agent ceiling)` `0 | 1 | 2`
  (off / ask / auto)
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
  out entirely for chat-only agents. `sessionToolModes` (async — it awaits the
  same `ctx.tools.filter(…)` pass) exposes the same computation to the UI;
  `unlinkAgent` (store) severs the link one-way,
  converting the session to plain workspace/chat permissions.
- Sub-agents: one `RunAgent {runs: […]}` call spawns all its child sessions
  concurrently; the ToolCard links to the live runs
  ([ADR-0022](../adr/0022-subagent-orchestration.md)). Delivery is one settle
  signal, two transports ([ADR-0060](../adr/0060-async-subagent-delivery.md),
  full picture in [agents.md](agents.md)): blocking mode waits on
  `engine.awaitSettled` (rides a child's user pause→resume, returns the final
  answer inline); async mode (`config.session.asyncAgents`, the DEFAULT) acks at
  once and the engine pushes each result on the parent's next idle turn — the
  recoverable path across a restart ([ADR-0073](../adr/0073-subagent-restart-recovery.md)). Either way the
  answer lands as a tool-result message in the PARENT's transcript — deleting
  child sessions (per-run, or all of a parent's via the right-panel cleanup
  button) costs only the child transcripts; mid-flight deletes stop the run first
  and the call settles as "stopped".
- **System prompt = overridable base + appended capability blocks**, resolved live
  each turn ([ADR-0052](../adr/0052-system-prompt-layering.md)). The BASE is the
  first match of: the agent's baked `session.system` → the session's container
  (workspace) message → the global `config.app.systemPrompt` → built-in
  `defaultChat` (sessions no longer bake the default at creation). On top, always
  appended when their capability is live: `workspace.system` (gated file tools — the
  `/` virtual root, ADR-0007, is stated, never assumed), `browser.system` (browser
  tools), `memory.system` (account), and **each enabled plugin's
  `manifest.systemPrompt`** (`enabledPluginPrompts()`). `{{language}}` (and vars)
  expand in the base too (`fill()`), not just built-ins.
- Validation failures (the generic `opts.validate` hook) trigger a bounded heal
  loop (hidden correction turns).
- Tool-produced media (generated or loaded) is fed back as a hidden user turn
  (`mediaFeedback`), filtered to what the model's declared inputs accept.
  Images are downscaled to the model's pixel cap (`imageMaxDim`, default 2048)
  as the result crosses the engine — UI, persistence, and model all share the
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
- **Persistence commits each message as it lands**, not as a turn-end
  whole-transcript write ([ADR-0072](../adr/0072-commit-on-landing.md)):
  `commitMessages` appends newly-finalized messages (`messages.put`, upsert by id)
  on `turn:start` / `tool:result` / `turn:deliver` / `turn:end`, holding an
  incomplete tool exchange (no stranded `tool_call`) and never writing turn scratch
  (the malformed/heal/`⚠️`/aborted messages). A crash loses at most the
  actively-streaming message. `replaceForSession` survives only for compaction.
  Media blobs are externalized once at creation; boot reads the session metas +
  the active transcript, the rest lazy-load via `ensureLoaded`. Message ids are
  ULIDs so reload order is creation order.
- **Sub-agent runs survive a restart** ([ADR-0073](../adr/0073-subagent-restart-recovery.md)):
  a durable `delivered` watermark (in `session.meta`) marks which children have
  reached the parent, and a boot `reconcile()` re-delivers the settled-but-
  undelivered and resumes the unfinished — the in-memory delivery queue doesn't
  survive a reload, but the durable transcript + watermark rebuild it.
