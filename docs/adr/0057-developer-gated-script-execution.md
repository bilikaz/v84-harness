# ADR-0057: Code execution returns as RunScript — out-of-process and developer-gated

Status: Accepted
Date: 2026-06-18
Follows [ADR-0056](0056-portable-workspace-tools.md) (which removed the shell). Gating is a straight application of [conventions/capability-gating.md](../conventions/capability-gating.md).

## Context

Removing Bash ([ADR-0056](0056-portable-workspace-tools.md)) also removed the only way for
the agent to *run code* it wrote. For the manager audience that's correct by default — but a
developer using the app still occasionally needs the agent to execute a script. The naive form
("let the agent write JS and eval it") is the dangerous one: eval'd code runs **in the harness's
own process** with the app's full privileges — it can `require("node:fs")` past the workspace
confinement, read the in-memory account token, and crash the app. That is strictly worse than the
Bash we just removed.

Two things make code execution safe, and they solve different risks: **a human gate** (only a
developer who opts in, approving each call — the same trust model Bash had) handles *who may run
it*, and **process isolation** (run it as a child process, not eval'd in) handles *the app staying
alive and confined*. We want both.

## Decision

**Add `RunScript` — a `local/` tool that executes a workspace `.js` file in a separate Node
process — gated behind a new `developerMode` flag.**

- **Out-of-process, not eval.** It spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1` — the
  app's **bundled** Node, so it's portable with no host install — `cwd` at the workspace root,
  capturing stdout+stderr+exit code (the shape Bash returned). A runaway/crashing script kills the
  child, never the harness, and can't reach in-process state. The agent writes the script with
  `Write` first, so it's a visible, reviewable artifact; `RunScript` runs it by path.
- **Developer-gated.** A new `config.app.developerMode: boolean` (default `false`) on `ConfigApp`,
  surfaced as a toggle in Settings → System. `RunScript.canRun()` returns `config.app.developerMode
  === true`. Per capability-gating, the same predicate runs at both boundaries: the advertise/list
  filters (`checkCanRun`) and the registry executor. So when developer mode is off, `RunScript` is
  not shown to the model, not listed in the permissions UI, and refused if called anyway — a regular
  user never encounters it. When on, it still defaults to **ask**, so each run is approved.
- **JS only.** Python and other interpreters depend on a host install, so they can't be the
  cross-platform guarantee; left out (a future `canRun`-gated extra, not part of this decision).

## Consequences

- Code execution exists again, but only for a developer who deliberately enables it — and even then
  in a process that can't take the app down or escape confinement by crashing. The default-audience
  surface is unchanged.
- `developerMode` is the first behavioral flag on `ConfigApp` beyond tunables; future developer-only
  affordances can gate on the same flag with the same `canRun` pattern.
- This is *not* a sandbox: an enabled, approved script has normal Node powers (fs, network). It's
  gated by a human + a process boundary, not isolated. A true powerless sandbox (a wasm JS engine,
  not native `isolated-vm`, to stay cross-platform) would be a separate, larger decision if the
  capability ever needs to be safe **without** a developer at the wheel.
