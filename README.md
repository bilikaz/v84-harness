# v84 harness

**Your own agent workbench.** A local-first, multi-session AI harness where agents
don't just chat — they read your files, run commands, browse the web, call APIs,
generate media, spawn sub-agents, and remember — all behind a permission model you
control, against any model you point it at.

Runs as a desktop app **or** in the browser. **Built for local models first** —
point it at your own vLLM / OpenAI-compatible endpoint and keep the entire loop on
your hardware. Cloud providers (Anthropic, Gemini) work too, but they're the
option, not the premise. Your data **and your models** stay yours; the cloud is
opt-in.

> Part of an all-TypeScript pipeline: **task-builder → harness → reviewer**, with
> company-knowledge RAG wired in as a permission-filtered tool.

---

## Why it's different

Most "chat with your repo" tools give you one assistant and a text box. This gives
you a **workbench**:

- 🧩 **Many sessions, many agents at once** — every chat is its own session; an
  orchestrator fans work out to **stored sub-agents running concurrently**, each in
  its own context, and collects their answers. And they're not a black box: each
  sub-agent is a **real, openable thread** — watch it stream live in the sidebar
  (indented under its parent), and click straight into its full transcript from the
  tool call that spawned it.
- 🗂️ **Real workspace tools, safely** — `Read` / `List` / `Grep` / `Write` /
  `Edit` / `Bash` over a folder, **confined to a virtual root** (the model never
  escapes the workspace), each tool gated **off / ask / auto** per workspace.
- 🌐 **Agents that actually browse** — managed browser windows the agent opens,
  reads, and navigates; it can **see** a page (screenshot to a vision model) or
  have it **described** (forms, buttons, layout) for text-only models. Hit a login
  or captcha? It asks *you* to handle it in the window, then carries on.
- 🔌 **Talk to any API** — a `Fetch` tool (method, headers, body) for hitting real
  services without a browser. Gated *ask* by default, because it can act anywhere.
- 🎨 **Generate media** — images and video from the chat, fed back to the agent so
  it can inspect what it made.
- 🧠 **Memory + company knowledge** — connect an account and agents gain a shared,
  searchable knowledgebase (hybrid sparse+dense RAG) and persistent memory.
- 🧱 **Build it for your needs** — the plugin system makes the harness *yours*: one
  folder under `plugins/<slug>/` adds new agent tools, settings, UI, and its own
  system-prompt guidance — wire in your database, your internal API, your team's
  workflow, whatever you need the agent to reach. First-party, in-tree, no install
  ceremony. (A MySQL plugin ships as the worked example to copy.)
- 🧭 **System prompts you own** — a global default, a per-workspace message, a
  per-agent playbook, and per-plugin tool guidance — layered, with capability
  instructions always added on top.
- ♻️ **Never loses the thread** — sessions auto-name themselves and auto-compact
  when they outgrow the context window.
- 🔒 **Local-first & private** — most harnesses are built around a cloud provider's
  API; this one is built for the models **you** run. Your self-hosted models, your
  machine, no per-token meter, no vendor lock-in. Connect the cloud only when *you*
  want shared memory and company knowledge.

All host-agnostic at the core: the **same renderer** runs as a pure web app and as
an Electron desktop app; desktop-only powers (the file/shell tools, the browser
fleet) light up when you run the Electron build.

---

## Quick start

```bash
pnpm install
pnpm dev:desktop            # web build — fast UI iteration (http://localhost:5173)
pnpm dev:desktop:electron   # the full Electron app (file/shell tools + browser fleet)
```

Then in **Settings**: pick your chat model under **Provider** (OpenAI-compatible /
vLLM, Anthropic, or Gemini), media endpoints under **Media models**, and your
default assistant instructions under **System message**.

> File/shell tools and the browser fleet need the **Electron** app; the browser
> build is for UI iteration (media tools work there too). vLLM is the
> primary, battle-tested provider path — start it with
> `--enable-auto-tool-choice --tool-call-parser …` so tools fire.

### Build the desktop app

```bash
pnpm dist:win    # package on a Windows host (electron-builder)
pnpm dist:mac    # package on a macOS host (electron-builder)
```

<details>
<summary>Windows packaging notes & gotchas</summary>

Run packaging on a **Windows host** (cross-building from WSL needs Wine; Windows is
the supported path). In **PowerShell**:

```powershell
node -v                                       # Node >= 24 required
corepack enable
corepack prepare pnpm@10.33.0 --activate
# If PowerShell blocks the pnpm script:
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
pnpm install                                  # downloads the Electron binary
pnpm --filter @v84-harness/desktop dist:win
```

Output → `apps/desktop/release/`: a **portable** single-file `.exe` and an **NSIS
installer**.

- **Build scripts must be allowed.** pnpm 10 skips dependency build scripts by
  default; `package.json` whitelists `electron`/`electron-builder`/`esbuild` via
  `pnpm.onlyBuiltDependencies`. If a checkout already installed, run
  `pnpm rebuild electron` (or `pnpm approve-builds`) to fetch the binary.
- **No native rebuild** — `build.npmRebuild: false` (no native modules).
- **Code-signing extraction needs symlink privilege** — enable **Developer Mode**
  or run the build in an **Administrator** PowerShell. Clear a corrupt cache with
  `Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"`.
- Artifacts are **unsigned** — SmartScreen shows "unknown publisher" on first run
  (*More info → Run anyway*). Real signing needs a certificate.

</details>

<details>
<summary>macOS packaging notes & gotchas</summary>

Run packaging on a **macOS host** — dmg creation and code-signing are macOS-only
and cannot be cross-built from WSL/Linux. Apple Silicon or Intel both work.

```bash
node -v                                       # Node >= 24 required
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install                                  # downloads the Electron binary
pnpm --filter @v84-harness/desktop dist:mac
```

Output → `apps/desktop/release/`: a **`.dmg`** for each architecture (`-arm64` and
`-x64` in the filename). The `.icns` is generated from `build/icon.png` (512×512).

- **No native rebuild** — `build.npmRebuild: false` (no native modules), so the
  cross-arch (arm64 + x64) build is safe from one host.
- **Builds are unsigned** (`mac.identity: null`) — electron-builder ad-hoc signs so
  the app launches locally, but Gatekeeper blocks it on other Macs with *"app is
  damaged and can't be opened"*. To open: **right-click → Open** (then *Open* in the
  dialog), or strip the quarantine flag once:

  ```bash
  xattr -cr "/Applications/V84 Harness.app"
  ```

- **Real distribution needs a Developer ID certificate + notarization** (Apple
  Developer account). When that's set up, drop `identity: null`, add
  `hardenedRuntime: true` + an entitlements file, and pass notarytool credentials
  via env — not wired up yet.

</details>

---

## How it's built

A pnpm-workspace monorepo:

- **`apps/desktop`** — the Electron + React harness (this is the app above).
- **`apps/knowledge`** — the remote backend it talks to when an account is
  connected: per-user durable storage, the knowledgebase, and auth (Hono + Node +
  MariaDB + OpenSearch).

The desktop app is **platform hosts over an agnostic core**: `core/` + the renderer
know nothing of the platform — they read a `ctx` (config + LLM client + storage +
tool gateway + host capabilities + the sessions engine); each platform (`electron/`,
`web/`) builds that `ctx` and installs the parts that differ. Tools are a folder-is-
the-registry system with permission tiers (`general` / `local` / `account`) plus an
**engine tier** for driver-level tools (sub-agents, the browser fleet).

The repo documents itself in three layers — start here:

- 🗺️ **Map** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) + the per-area docs in
  [docs/architecture/](docs/architecture/) (sessions, tools, browser, llm, storage,
  plugins, …).
- 📐 **Conventions** — portable engineering rules in
  [docs/conventions/](docs/conventions/).
- 🧾 **Decisions** — the dated ADR log in [docs/adr/](docs/adr/).

The working procedure that keeps those in sync (and that agent sessions read on
start) is [CLAUDE.md](CLAUDE.md).

---

## The bigger pipeline

```
task-builder (RAG + ingest + API)
      │  company-knowledge exposed as a permission-filtered tool
      ▼
  harness (this repo)  ── orchestrates sessions ──►  reviewer (quality gate)
```

A reviewer gate (`@bilikaz/code-reviewer`) runs on PRs via
`.github/workflows/review.yml`.

## Roadmap / honest edges

- **Worktree isolation** — the workspace isolation toggle is stored but not yet
  wired; tools run in the workspace root.
- **Remote workspaces** — the `remote` container type is scaffolded (data model +
  tool tier); the VM runtime behind it isn't built yet.
- **Anthropic / Gemini tool calling** — wired; the vLLM/OpenAI-compatible path is
  the battle-tested one.
- **`Bash` refactor** — it's too open-ended and has no real shell on Windows; a
  narrower, cross-platform command surface is planned (see [TODO.md](TODO.md)).

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
