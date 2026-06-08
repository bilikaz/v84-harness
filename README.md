# v84 harness

A **multi-session agent harness** — an Electron desktop app that runs agent
sessions against a workspace folder, with file/shell tools, per-workspace
permissions, and automatic context compaction. Part of a larger all-TypeScript
pipeline (task-builder → harness → reviewer).

## Run it

```bash
pnpm install
pnpm dev:desktop            # renderer only, in the browser (http://localhost:5173)
pnpm dev:desktop:electron   # the full Electron app (tools + folder access)
```

Tools and folder access need the Electron app; the browser build is for fast UI
iteration. Configure the model in **Settings → Provider** (OpenAI-compatible /
vLLM endpoint, e.g. `https://llm.v84.eu:2083/v1`).

## What works

- **Workspaces** — a workspace is a folder + settings. Sessions are scoped to a
  workspace; the sidebar switches between workspaces and their sessions. Add via
  the native folder picker; each workspace has a name, default model, isolation
  mode, optional project instructions, and a **per-tool permission map**.
- **Tool-use loop** — the model is given the workspace's enabled tools and the
  turn loops (stream → run tools → feed results back → repeat). Tools:
  `Read`, `List`, `Grep`, `Write`, `Edit`, `CreateFolder`, `Bash`. They run in
  the Electron **main** process (Node `fs`/`child_process`).
- **Virtual-root confinement** — the model only ever sees workspace-relative
  paths (`/` = the workspace root). fs tools reject anything escaping the
  workspace (`..`, absolutes, escaping symlinks); `Bash` paths are rewritten to
  stay inside.
- **Per-tool permissions (`0/1/2`)** — disabled / ask / auto, set per workspace.
  fs tools default to auto (confinement is the safety); `Bash` asks by default
  (it can't be confined) via an approval dialog.
- **Auto-compaction** — when a session crosses its usable budget
  (context window − a configurable **system reserve**, min 10%), the
  conversation is summarized (small thinking budget) and replaced with a single
  hidden summary that's resent to the model. Manual "Summarize" in the context
  card; the card shows usage against the usable budget.
- **Providers** — OpenAI-compatible (incl. vLLM thinking: `enable_thinking` +
  `thinking_token_budget`), Anthropic, Gemini. Multimodal images + file
  attachments in the composer.
- **Reviewer gate (CI)** — `@reviewer/cli` (pinned `v0.1.1`) runs on PRs via
  `.github/workflows/review.yml`.

## Architecture

```
src/
  main/        Electron main — window, IPC wiring, native dialog (host glue)
  preload/     contextBridge → window.harness (the IPC bridge)
  bridge.ts    the main↔renderer contract (types + channel names)
  core/        host-agnostic logic — sessions (store/driver/listeners/…),
               tools (dispatcher + Read/Bash/…), workspaces, approvals, compaction
  providers/   LLM clients (OpenAI/Anthropic/Gemini), unified StreamEvent
  pages/, components/, lib/   the React renderer (browser-runnable)
```

- **Trust boundary is `main`** — tools execute there; the renderer reaches them
  only through `window.harness`. Dependency direction is one-way:
  `core ← bridge ← {main, preload, renderer}`.
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
  stored but tools currently always run in the workspace root.
- Anthropic/Gemini tool-calling shapes not wired (OpenAI-compatible path only).
- The live agent loop wants real runtime testing against `llm.v84.eu` (vLLM must
  be started with `--enable-auto-tool-choice --tool-call-parser …` for tools to
  fire, and support `thinking_token_budget`).
