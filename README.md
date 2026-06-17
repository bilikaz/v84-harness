# v84 harness

A **multi-session agent harness** — an Electron desktop app that runs agent
sessions against a workspace folder, with file/shell tools, per-workspace
permissions, media generation, and automatic context compaction. Part of a
larger all-TypeScript pipeline (task-builder → harness → reviewer).

## Run it

```bash
pnpm install
pnpm dev:desktop            # renderer only, in the browser (http://localhost:5173)
pnpm dev:desktop:electron   # the full Electron app (tools + folder access)
pnpm dist:win               # package (electron-builder; run on a Windows host)
```

Tools and folder access need the Electron app; the browser build is for fast UI
iteration (only the media tools work there). Configure the chat model in
**Settings → Provider** (OpenAI-compatible / vLLM, Anthropic, or Gemini) and
the generation endpoint in **Settings → Media**.

## What works

- **Workspaces** — a workspace is a folder + settings: name, default model,
  isolation mode, optional project instructions (per-workspace system prompt),
  and a **per-tool permission map**. Sessions are scoped to a workspace; the
  sidebar switches between workspaces and their sessions. Sessions without a
  workspace are plain chats (media tools only).
- **Tool-use loop** — the model gets the workspace's enabled tools and the turn
  loops: stream → run tool calls → feed results back → repeat (max 50 steps).
  **Parallel tool calls are supported on all three providers** — all calls of a
  step run concurrently, results are linked by call id.
- **Tools** — gated fs/shell tools run in Electron **main** (Node
  `fs`/`child_process`): `Read`, `List`, `Grep`, `Write`, `Edit`,
  `CreateFolder`, `Bash`, plus the media loaders `LoadImage`/`LoadVideo`
  (advertised only when the model declares the matching image/video input).
  Permissionless media tools run in the renderer and work everywhere (browser
  build included): `GenerateImage`, `GenerateVideo`. Tool output is capped at
  64 KB per result.
- **Per-tool permissions (`0/1/2`)** — disabled / ask / auto, set per
  workspace. fs tools default to auto (confinement is the safety); `Bash` asks
  by default via an approval dialog (a queue — concurrent sessions and parallel
  calls each get their prompt).
- **Virtual-root confinement** — the model only ever sees workspace-relative
  paths (`/` = the workspace root). fs tools reject anything escaping the
  workspace (`..`, absolutes, escaping symlinks); `Bash` command paths are
  rewritten in, and real paths scrubbed out of its output.
- **Media generation** — `GenerateImage` (quality presets, aspect ratios,
  negative prompt) and `GenerateVideo` (duration up to 10s) POST to the media
  endpoint and return data-URLs. Prompts are upsampled into the provider's
  JSON schema by the chat model through a validate→heal loop. Tool-produced
  media — generated or loaded from the workspace — is fed back to the model as
  a hidden turn (images and video, each only when the model's declared inputs
  accept it) so the agent can inspect it; save/copy/paste via native dialogs.
- **Auto-compaction** — when a session crosses its usable budget
  (context window − reserve), the conversation is summarized in the background
  and replaced with a single hidden summary. Manual "Summarize" in the context
  card; the card shows usage against the usable budget.
- **Auto-naming** — sessions title themselves after the first exchange.
- **Stored agents** — reusable playbooks (system MD + user MD + optional JSON
  output contract with required keys). Running one spins up a session whose
  output is validated and healed against the contract.
- **Persistence** — a detected durable tier (SQLite in Electron > IndexedDB >
  localStorage) holding granular rows: a session index, per-session messages,
  and media blobs written once at creation. Boot loads the index + active
  session; the rest lazy-loads. No cloud; everything is local.
- **Reviewer gate (CI)** — `@bilikaz/code-reviewer` runs on PRs via
  `.github/workflows/review.yml`.

## The LLM layer (`src/providers/`)

One call algorithm, one retry policy, one heal contract — providers are pure
wire-format mappers and everything shared lives in the router:

```
types.ts       the provider-agnostic contract: ChatMessage, ToolCall, ToolSpec,
               StreamEvent (text | thinking | tool_call | usage | retry | error | done)
transport.ts   wire recovery — sseRequest (one fetch + typed HttpError) and
               withRetry (408/429/5xx/network → backoff + jitter + Retry-After,
               max 3 re-sends; 4xx/abort are fatal; emits "retry" so consumers
               discard the dead attempt's partial output)
openai.ts      ┐ mappers only: translate the contract to/from each wire format
anthropic.ts   │ (incl. tool calls — OpenAI tool_calls[], Anthropic tool_use
gemini.ts      ┘ blocks, Gemini functionCall parts), nothing else
index.ts       the router: streamModel (mapper + retry + inline-<think> demux),
               chatOnce (the non-streaming call — the same stream, buffered),
               healLoop/healCorrection (semantic repair), model listing
```

The two recovery layers are deliberately separate:

- **Transport retry** (below the call): the request failed — lost connection,
  429, 529 overloaded. There is no output to fix, so the identical request is
  re-sent. Applies to every caller automatically: chat turns, auto-naming,
  compaction, the upsamplers.
- **Heal** (above the call): the output exists but fails validation. A
  correction turn quoting the error is injected into the same conversation and
  the model retries (max 3). The chat driver drives it through the session
  store/bus; standalone callers use `healLoop(chatOnce)`.

There is **no separate non-streaming path** — `chatOnce` drains the same
stream to completion. "Streaming vs call" is only whether the consumer forwards
deltas (driver → bus → UI) or buffers them.

## Architecture

```
src/
  main/        Electron main — window, IPC handlers, native dialogs, tool dispatcher
  preload/     contextBridge → window.harness (the IPC bridge)
  bridge.ts    the main↔renderer contract (types + channel names)
  core/        host-agnostic logic
    sessions/  store (state + persistence), driver (the turn/tool loop),
               listeners (bus → store), events, naming, compaction
    tools/     tool implementations + dispatcher types, virtual-root paths
    workspaces.ts, approvals.ts
  providers/   the LLM layer (see above)
  pages/, components/, lib/   the React renderer (browser-runnable)
docs/
  ARCHITECTURE.md     the map: structure, patterns, flows
  STORAGE.md          the storage chart: key scheme, shapes, accessor surface
  conventions/        portable engineering rules (naming, types placement, …)
  adr/                dated architecture decision records (scope: ADR-0000)
```

Documentation is layered: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is this
repo's map, [docs/conventions/](docs/conventions/) holds the portable rule set,
and [docs/adr/](docs/adr/) is the decision log. The working procedure that
maintains these layers is the root [CLAUDE.md](CLAUDE.md) — agent sessions read
it on start.

- **Trust boundary is `main`** — gated tools execute there; the renderer
  reaches them only through `window.harness`. Dependency direction is one-way:
  `core ← bridge ← {main, preload, renderer}`.
- The driver publishes events; listeners update the store; React binds to the
  store. The driver itself is React-free.
- `core/` is staged here; it lifts into a shared `packages/core` later (reused
  by a cloud API runner / CLI).

## The bigger pipeline

```
task-builder (cloud: RAG + ingest + API)
      │  company-knowledge RAG exposed as a tool (permission-filtered)
      ▼
  harness (this repo)  ── orchestrates sessions ──►  reviewer (quality gate)
```

## Known / next

- **Worktree isolation is not yet wired** — the workspace "isolation" toggle is
  stored but tools always run in the workspace root.
- **Anthropic/Gemini tool calling is wired but not yet live-tested** — the
  OpenAI-compatible path (vLLM) is the primary, battle-tested one. vLLM must be
  started with `--enable-auto-tool-choice --tool-call-parser …` for tools to
  fire.
- **Batch agent loop extraction** — the full stream→tools→heal cycle currently
  lives only in the session driver; headless (no-UI) agents need it extracted
  into a plain-array runner, with the driver becoming a thin bus/store adapter.
- Gemini can reject unsupported JSON-Schema keywords in tool `parameters`; a
  schema sanitizer may be needed in its mapper.
- `packages/core` lift, cloud sync — later.

## License

Licensed under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)) — © 2026 VBTECH.

You may use, modify, run, and **commercially host it (including as a SaaS)**. The AGPL's
network-copyleft is the catch: if you run a modified version for others over a network, you
must make your modified source available to them under the AGPL. The intent is that use feeds
the project's growth rather than forking off silently — improvements flow back as code.

**Commercial license.** To use it in a closed-source product/service without the AGPL's
source-sharing obligations, a commercial license is available — contact
**valdas@vbtech.eu**. So a business contributes back either way: as code
(pull requests / its AGPL-published changes) or financially (a commercial license).

Contributions are welcome by pull request. Once outside contributions are accepted, a
Contributor License Agreement will be required so the project can keep offering the commercial
option (the maintainer needs the rights to relicense).
