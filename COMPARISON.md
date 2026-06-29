# How v84 harness compares

*As of mid-2026, based on each project's public docs. The agent space moves fast —
corrections welcome by PR.*

> **Short version:** v84 runs code-defined agent graphs **as chats**, in a
> local-first desktop app, with machine tools and a scoped knowledgebase built in —
> a combination the tools below each cover only part of.

Agent tooling has converged on **graph-based orchestration** to tame the
non-determinism of LLMs — explicit nodes and edges instead of a model re-deciding
the whole process every run. Great frameworks exist for pieces of this. What none
of them ship is the **whole stack in one local-first desktop app**: a code-defined
graph runtime that runs **as an ordinary chat you talk to**, with real workspace
tools, browser automation, company-knowledge RAG, and a per-agent permission model
— all in TypeScript, all in-process, all pointed at the models *you* run.

That combination is what v84 focuses on.

v84 gets compared along two axes: the **orchestration frameworks** below (Rivet,
LangGraph, Mastra…) and, on [the other side](#the-other-side--desktop-llm-clients--single-agent-apps),
the **desktop LLM clients** (Hermes Desktop, LM Studio, Jan, AnythingLLM…). It's
neither a pure framework nor a pure chat client — it's the **harness in between**.

## The landscape at a glance — orchestration frameworks

| | **v84 harness** | Rivet | LangGraph.js | Mastra | Eigent | Langflow / Flowise / n8n |
|---|---|---|---|---|---|---|
| **Local-first desktop app** | ✅ Electron | ✅ desktop | ❌ library | ❌ library | ✅ Electron | ◐ Langflow has a desktop build |
| **Graph runtime language** | **TypeScript, in-process** | TypeScript (`rivet-core`) | TS port of a Python-first lib | TypeScript | **Python sidecar** | Python / TS |
| **Orchestration model** | event-driven node graph | node graph | node/edge graph | step-based (`.then/.branch`) | multi-agent | visual node graph |
| **How graphs are authored** | **code** (plugin classes) | **visual** editor (YAML) | code | code | config | **visual** drag-and-drop |
| **Graph runs *as a chat session*** | ✅ the chart **is** the transcript | ❌ it's an IDE | ❌ it's a library | ❌ | ◐ cowork UI | ❌ deploys an endpoint |
| **Sub-agents as real, openable live threads** | ✅ | ❌ | ❌ | ❌ | ◐ | ❌ |
| **Native MCP client (tools + OAuth)** | ✅ | ◐ | ◐ (BYO) | ◐ | ◐ | ◐ |
| **Built-in file tools (virtual-root, gated; no free-form shell)** | ✅ | ❌ | ❌ (BYO) | ❌ (BYO) | ✅ | ◐ via nodes |
| **Built-in browser automation (see *or* describe)** | ✅ | ❌ | ❌ | ❌ | ✅ | ◐ via nodes |
| **Built-in company-knowledge RAG, visibility-scoped** | ✅ | ❌ | ❌ (BYO) | ◐ pluggable memory | ◐ | ◐ via nodes |
| **Per-agent tool permission model (off/ask/auto + grounding)** | ✅ | ❌ | ❌ | ❌ | ◐ | ❌ |
| **Local-model-first / no cloud dependency** | ✅ | ◐ | ◐ | ◐ | ◐ | ◐ |
| **Pause / resume (human-in-the-loop)** | ✅ in-memory break→park→`continue` | ◐ | ✅ checkpointer (cross-restart) | ✅ durable (Inngest) | ◐ | ◐ |

✅ first-class · ◐ partial / possible with setup · ❌ not the design center (not "impossible")

## Tool by tool — what they're great at, and what we add

### Rivet (Ironclad) — the closest in spirit
Rivet is an excellent **visual** AI programming environment: a node editor for
prompt/agent graphs, live debugging, and `@ironclad/rivet-core`, a TypeScript
library you can embed to run those graphs. It nails "a graph runtime you can put in
your own app."

**What we add:** our graphs are **code, not a canvas** — versioned plugin classes,
not YAML drawn in an editor — and they run **as a conversation**: you drive a run
with `start` / `continue` / `<node>` *messages*, the run's chart **is** the chat
transcript, and each head is a real openable child session. Rivet is a builder you
design graphs in; v84 is a **harness you run them in, as chats**, with file tools,
browsing, and RAG already wired.

### LangGraph / LangGraph.js — the closest in model
LangGraph is the reference graph-orchestration model: typed state, conditional
edges, checkpointing, and a strong human-in-the-loop story (`interrupt()` + resume
by `thread_id`). LangGraph.js brings it to TypeScript.

**What we add:** LangGraph is a **library, Python-first**, that you assemble into an
app and wire a UI, tools, and storage around. v84 is the **finished local-first
app** — the graph engine, the chat surface, workspace tools, the browser fleet, and
permissioned RAG ship together. Our pause model is deliberately lighter: a node
*validates its own input* and **breaks** (`ctx.break`) to **park** the run
in-memory; a `continue` message re-runs that node. We trade LangGraph's
checkpointer-backed **cross-restart** resume for a zero-config, conversation-native
one. (If durable cross-restart resume matters to you, that's LangGraph's edge — and
a slice we could add.)

### Mastra — the closest in language
Mastra is a strong **TypeScript-native** agent framework: agents as objects, tools
as typed functions, durable workflows on Inngest, pluggable memory. Less ceremony
than LangGraph for many TS teams.

**What we add:** Mastra is **step-based** (`.then()` / `.branch()`) and proudly "no
graph theory"; we're an **event-driven node graph** with fan-out, **arrival-driven
joins**, and producer-declared synchronization — built for parallel sub-agent work
(N reviewers → verify → join → consolidate). And Mastra is a backend framework; v84
is the **desktop harness** with the chat UI, file/browser tools, and RAG included.

### Eigent — the closest in packaging
Eigent is a local-first **Electron** desktop app with a polished multi-agent
"cowork" experience.

**What we add:** Eigent's orchestration lives in a **Python layer** behind the
Electron UI. v84 keeps the **entire loop in one TypeScript process** — engine,
tools, sessions — no Python sidecar, and exposes the orchestration as a
**code-defined graph** plus a per-agent permission/grounding model.

### Langflow / Flowise / n8n — the visual low-code camp
These are excellent **visual** builders: drag-and-drop nodes for RAG pipelines,
chatbots, and automations (Langflow even ships a desktop build; Flowise's Agentflow
does multi-agent).

**What we add:** they target **low-code visual authoring** and **deploying an
endpoint**. v84 targets **engineers** who want graphs as **code in their repo**
(diffed and reviewed like any module), running inside a **harness with real
local-machine powers** (confined file access, developer-gated script execution, a
managed browser the agent drives) rather than a hosted chatbot.

## The other side — desktop LLM clients & single-agent apps

There's a second crowd v84 gets compared to: **local-first desktop chat clients**.
These are excellent at "download a model and talk to it" (and, increasingly, "chat
with your docs" and MCP) — but they're **chat front-ends**, not agent workbenches
with orchestration. Most are a great **complement**: point v84 at the very same
local endpoint they serve.

| | **v84 harness** | Hermes Desktop | LM Studio · Jan · GPT4All | AnythingLLM · Msty · Cherry Studio · Open WebUI |
|---|---|---|---|---|
| **What it is** | agent **workbench** | GUI over a single self-improving agent | **model runner + chat** | **RAG-first chat** UI |
| **Multi-agent orchestration** | ✅ graphs + sub-agents | ❌ one agent | ❌ | ❌ |
| **Code-defined graph runtime** | ✅ | ❌ | ❌ | ❌ |
| **Sub-agents as openable live threads** | ✅ | ❌ | ❌ | ❌ |
| **Virtual-root file tools, gated (no free-form shell)** | ✅ | ◐ `/shell` `/code` (agent) | ❌ | ◐ via skills/MCP |
| **Agent-driven browser (see *or* describe)** | ✅ | ◐ `/browse` | ❌ | ◐ via MCP |
| **Company-knowledge RAG, visibility-scoped** | ✅ | ◐ memory | ◐ LocalDocs | ✅ (doc-centric) |
| **Engine in-process, all-TypeScript** | ✅ | ❌ Python backend | n/a (runner) | varies |
| **Local-model-first** | ✅ | ✅ | ✅ | ✅ |

✅ first-class · ◐ partial · ❌ not the design

- **Hermes Desktop** (Nous Research's Hermes Agent, community Electron+React shell
  over a Python backend) is the closest on this side: a real **tool-using agent**
  with slash commands (`/shell`, `/browse`, `/code`, `/memory`, `/skills`) and broad
  provider support. But it's a **GUI around one self-improving agent**, not a
  multi-agent graph engine — there's no code-defined orchestration, no fan-out/join,
  no sub-agents-as-threads, and the brains live in an external Python process.
- **LM Studio / Jan / GPT4All / Ollama** are model **runners + chat** (browse GGUF,
  chat, expose a local OpenAI server; GPT4All adds LocalDocs RAG). They don't
  orchestrate or act on your machine — and they're the perfect thing to **serve the
  endpoint v84 points at**.
- **AnythingLLM / Msty / Cherry Studio / Open WebUI** are polished **RAG/chat** front
  ends (chat-with-your-docs, MCP, multi-provider). Strong at document Q&A; not agent
  harnesses — no graph orchestration, no confined machine tools, no sub-agent teams.

**The line:** they answer *"let me chat with a model (and my docs)."* v84 answers
*"let me orchestrate a team of agents that act on my machine and my knowledge, as
code, behind a permission model."* Different jobs — and v84 happily sits **on top
of** the runner they already have.

## What v84 brings together

Plenty of tools do one or two of these. Bringing them together in a single
local-first app is what makes v84 its own thing:

1. **Code-defined, event-driven graphs** (fan-out, arrival-driven joins, node
   breaks) — versioned in your repo, not drawn on a canvas.
2. **The graph runs as a chat session** — control is plain `start` / `continue` /
   `<node>` messages, the chart is the transcript, sub-agents are openable live
   threads.
3. **A real local-machine harness** — virtual-root file tools (no free-form shell)
   and a managed browser the agent sees *or* has described, each gated
   **off / ask / auto**.
4. **Per-agent tool grounding** — `{ "*": 0, … }` restricts an agent to exactly the
   tools its job needs, so heads stay on task.
5. **A native MCP client** — connect any MCP server (stdio / streamable-HTTP),
   including **OAuth 2.1 + PKCE** with machine-encrypted tokens; its tools join the
   model's tool list and permission catalog like first-party ones.
6. **Built-in, visibility-scoped company-knowledge RAG** + persistent memory
   (hybrid sparse+dense over OpenSearch via `apps/knowledge`).
7. **A first-party plugin system** — one in-tree folder adds tools, settings, UI, and
   prompt guidance (the code-review graph and a SQL database plugin — MySQL + Postgres
   — ship as examples).
8. **Local-model-first** — built for your own vLLM / OpenAI-compatible endpoint, with
   a concurrency runner that keeps it from overrunning its KV cache. The entire loop
   can stay on your hardware; cloud is opt-in.

LangGraph has the richest pause model; Rivet has the visual canvas; Mastra has the
leanest TS API; the visual tools have the gentlest on-ramp. **v84 is the one that
ships the graph runtime, the chat harness, the local-machine tools, and the
knowledgebase together as one private, all-TypeScript app.**

## Where we're honest about the edges

- **No visual graph editor** — graphs are code by design (Rivet is your tool if you
  want a canvas).
- **Company knowledge needs a connected account** — the RAG + shared memory live in
  `apps/knowledge`; offline you still get the full local workbench, just not the
  shared knowledgebase.

See the [architecture map](docs/ARCHITECTURE.md) and the
[decision log](docs/adr/) for how each of these is actually built.

---

**Want to try it?** → [Quick start in the README](README.md#quick-start). Point it at
the local endpoint you already run and drive your first graph with a `start` message.
