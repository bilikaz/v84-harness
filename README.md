# v84 harness

**Run a team of AI agents on your own machine, against your own models — and orchestrate them as code that runs like a chat.**

![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-2C2E3B?logo=electron&logoColor=white)
![Node ≥24](https://img.shields.io/badge/Node-%E2%89%A524-339933?logo=node.js&logoColor=white)
![local-first](https://img.shields.io/badge/local--first-%E2%9C%93-success)

*Most "chat with your repo" tools give you one assistant and a text box. This gives
you a **workbench** — and a graph engine you drive like a conversation.*

A local-first agent workbench: agents read your files, run scripts, browse the web,
call APIs, generate media, and spawn sub-agents — behind a permission model you
control, pointed at any model you run. **Built for local models first** (your own
vLLM / OpenAI-compatible endpoint, the whole loop on your hardware); Anthropic and
Gemini work too, but the cloud is opt-in. Runs as a desktop app **or** in the browser.

---

## The one thing nobody else does

Beyond free-form chat, express a fixed process as an **event-driven graph** — fan
work out, run reviewers in parallel, **join** when every branch arrives, consolidate.
It runs **as an ordinary chat you drive with `start` / `continue` messages**: the
chart *is* the transcript, every node is a real **openable** thread, and any node can
**pause for your input and resume**. Graphs are **code in your repo** — diffed and
reviewed like any module, not boxes on a canvas.

```text
you      ▸ start                       (or click ▶ in the Flows panel)
engine   ▸ scope → fan-out: 3 reviewers run in parallel    [3 live threads ↓]
   ├ security      ▸ streaming…  → 1 finding        (open ↗)
   ├ logic         ▸ streaming…  → clean            (open ↗)
   └ conventions   ▸ streaming…  → 2 findings        (open ↗)
engine   ▸ verify each → join (waits for all) → consolidate
engine   ▸ exit → ```json { "findings": [ … ] }      ← final, copy-pasteable
you      ▸ continue                    (resume a paused step, same chat)
```

A multi-agent **code-review** flow ships as the worked example. How this stacks up
against LangGraph, Rivet, Mastra & the desktop chat clients → **[COMPARISON.md](COMPARISON.md)**.

---

## In three lines

- **Orchestrate, don't just chat.** Code-defined graphs of parallel sub-agents,
  running as a live transcript you can open into.
- **Real machine powers, safely.** Confined file tools, developer-gated script
  execution, an agent-driven browser, any-API fetch — each gated **off / ask / auto**.
- **Yours end to end.** Your models, your hardware, your knowledgebase. No per-token
  meter, no lock-in.

---

## Everything in the box

- 🧩 **Many sessions, many agents at once** — every chat is its own session; an
  orchestrator fans work out to **stored sub-agents running concurrently**, each in
  its own context, and collects their answers. Each sub-agent is a **real, openable
  thread** — watch it stream live in the sidebar (indented under its parent), and
  click straight into its full transcript from the tool call that spawned it. Failed
  runs return a **typed next action** (resume a transport blip, or summarize instead
  of retrying an out-of-memory one), so a long multi-agent job degrades gracefully.
- 🗂️ **Real workspace tools, safely** — `Read` / `List` / `Find` / `Grep` / `Write`
  / `Edit` / `Move` / `Copy` / `Delete`, plus a developer-gated `RunScript`, all
  **confined to a virtual root** (tool paths resolve against it, with symlink-escape
  checks), each gated **off / ask / auto** per workspace. **No free-form shell by
  design** — the file surface is pure, portable `node:fs`, so it behaves identically
  on every OS.
- 🔀 **Deterministic graph orchestration** — see [above](#the-one-thing-nobody-else-does):
  code-defined, event-driven graphs (fan-out, arrival-driven joins, node breaks) that
  run as a chat you drive with messages.
- 🌐 **Agents that browse** — managed browser windows the agent opens, reads, and
  navigates; it can **see** a page (screenshot to a vision model) or have it
  **described** (forms, buttons, layout) for text-only models. Hit a login or
  captcha? It asks *you* to handle it in the window, then carries on.
- 🔌 **Talk to any API** — a `Fetch` tool (method, headers, body) for hitting real
  services without a browser. Gated *ask* by default, because it can act anywhere.
- 🧰 **Native MCP client** — connect any Model Context Protocol server (stdio or
  streamable-HTTP); its tools join the model's tool list and the permission catalog
  like first-party ones. Three auth modes including **OAuth 2.1 + PKCE** (in-app
  consent window, machine-encrypted tokens) and self-healing reconnect.
- ⚡ **Built for local endpoints** — a concurrency runner with per-model caps,
  per-service **priority pools**, and provider-affinity slot leasing keeps a local
  vLLM endpoint from overrunning its KV cache when many agents run at once (you see a
  "waiting for a slot" indicator instead of a stall).
- 🎨 **Generate media** — images and video from the chat, fed back to the agent so it
  can inspect what it made.
- 🧠 **Memory + company knowledge** — connect an account and agents gain a shared,
  **visibility-scoped** (shared vs. private) knowledgebase (hybrid sparse+dense RAG,
  accent-insensitive) and persistent memory.
- 🧱 **Build it for your needs** — one folder under `plugins/<slug>/` adds agent
  tools, settings, UI, and its own system-prompt guidance — first-party, in-tree.
  Wire in your database, your internal API, your team's workflow. (A SQL database
  plugin — **MySQL + Postgres** — and the MCP client ship as worked examples.)
- 🧭 **System prompts you own** — a global default, a per-workspace message, a
  per-agent playbook, and per-plugin tool guidance — layered, with capability
  instructions always added on top.
- ♻️ **Keeps long sessions going** — sessions auto-name themselves and auto-compact
  when they outgrow the context window.
- 🔒 **Local-first & private** — built for the models **you** run: your hardware, no
  per-token meter, no vendor lock-in. Connect the cloud only when *you* want shared
  memory and company knowledge.

All host-agnostic at the core: the **same renderer** runs as a pure web app and as an
Electron desktop app; desktop-only powers (the file tools, the browser fleet) light
up when you run the Electron build.

---

## Quick start

```bash
pnpm install
pnpm dev:desktop            # web build — fast UI iteration (http://localhost:5173)
pnpm dev:desktop:electron   # the full Electron app (file tools + browser fleet)
```

Then in **Settings**: pick your chat model under **Provider** (OpenAI-compatible /
vLLM, Anthropic, or Gemini), media endpoints under **Media models**, and your default
assistant instructions under **System message**.

> File tools and the browser fleet need the **Electron** app; the browser build is
> for UI iteration (media tools work there too). vLLM is the primary, most-exercised
> provider path — start it with `--enable-auto-tool-choice --tool-call-parser …` so
> tools fire.

**Packaging a desktop build** (Windows `.exe` / macOS `.dmg`) → see **[BUILDING.md](BUILDING.md)**.

---

## How it compares

The agent world is converging on graph orchestration (LangGraph, Rivet, Mastra,
Flowise…), and the desktop side is full of local chat clients (Hermes, LM Studio,
Jan, AnythingLLM…). Each ships only **part** of the stack — a Python library here, a
visual canvas there, a cloud-bound chatbot builder elsewhere. **v84 brings a
code-defined graph runtime, a chat harness, local-machine tools, and a scoped
knowledgebase together in one all-TypeScript app pointed at the models you run** —
neither a pure framework nor a pure chat client, but the harness in between.

Full breakdown — feature matrix, tool-by-tool, and an honest list of the edges where
others lead → **[COMPARISON.md](COMPARISON.md)**.

---

## How it's built

A pnpm-workspace monorepo:

- **`apps/desktop`** — the Electron + React harness (this is the app above).
- **`apps/knowledge`** — the remote backend it talks to when an account is connected:
  per-user durable storage, the knowledgebase, and auth (Hono + Node + MariaDB +
  OpenSearch).

The desktop app is **platform hosts over an agnostic core**: `core/` + the renderer
know nothing of the platform — they read a `ctx` (config + LLM client + storage +
tool gateway + host capabilities + the sessions engine); each platform (`electron/`,
`web/`) builds that `ctx` and installs the parts that differ. Tools are a folder-is-
the-registry system with permission tiers (`general` / `local` / `account`) plus an
**engine tier** for driver-level tools (sub-agents, the browser fleet).

The repo documents itself in three layers — start here:

- 🗺️ **Map** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) + the per-area docs in
  [docs/architecture/](docs/architecture/) (sessions, tools, browser, llm, storage,
  graph, knowledge, plugins, …).
- 📐 **Conventions** — portable engineering rules in
  [docs/conventions/](docs/conventions/).
- 🧾 **Decisions** — the dated ADR log in [docs/adr/](docs/adr/).

The working procedure that keeps those in sync (and that agent sessions read on
start) is [CLAUDE.md](CLAUDE.md).

---

## Roadmap / honest edges

- **No visual graph editor** — graphs are code by design. If you want a drag-and-drop
  canvas, Rivet is the tool; v84 is for graphs you keep in your repo.
- **Worktree isolation** — the workspace isolation toggle is stored but not yet wired;
  tools run in the workspace root.
- **Remote workspaces** — the `remote` container type is scaffolded (data model + tool
  tier); the VM runtime behind it isn't built yet.
- **Anthropic / Gemini tool calling** — wired; the vLLM/OpenAI-compatible path is the
  one we develop and test against day to day.

## License

Licensed under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)) — © 2026 VBTECH.

You may use, modify, run, and **commercially host it (including as a SaaS)**. The AGPL's
network-copyleft is the catch: if you run a modified version for others over a network, you
must make your modified source available to them under the AGPL — improvements flow back as code.

**Commercial license.** To use it in a closed-source product/service without the AGPL's
source-sharing obligations, contact **valdas@vbtech.eu**.

Contributions are welcome by pull request. Once outside contributions are accepted, a
Contributor License Agreement will be required so the project can keep offering the commercial
option.
