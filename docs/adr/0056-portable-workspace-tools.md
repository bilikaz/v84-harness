# ADR-0056: Portable workspace tools — the shell becomes typed file operations

Status: Accepted
Date: 2026-06-18
Amends [ADR-0033](0033-tools-registry-folder-by-permission.md) (the `local/` tier listing + `defaultPermission` example) and [ADR-0007](0007-tool-system.md) (the gated-tool set). The dynamic-registry mechanism is unchanged.

## Context

Two `local/` tools shelled out to Linux binaries that don't exist on stock Windows:
`Bash` (`spawn("bash", ["-lc", …])`) and `Grep` (`spawn("grep", ["-rIn", …])`. Every
other `local/` tool was already pure `node:fs` and portable. The app is meant for a
**non-developer** audience (managers doing document/file work), where a free-form shell
is also the wrong capability: it's the only arbitrary-execution surface, its commands
(`sed`/`awk`/`ls`) are Unix idioms, and it can't be path-confined.

The unportable part of `Bash` is precisely the *shell* — pipes, redirects, globbing,
chaining, inline `sed`/`awk`. Decompose those responsibilities into typed operations and
each becomes portable *by construction* (the runtime's own APIs run the same everywhere).

## Decision

**Remove the free-form shell; cover its real workload with typed, portable tools.**

- **`Bash` is deleted.** Its inspection/edit workload is already covered (Read, List,
  Grep, Write, Edit, CreateFolder); the shell-composition cases are not this audience's work.
- **`Grep` is reimplemented in pure Node** — recursive `fs` walk, JS `RegExp`, NUL-byte
  binary-file skip, line-numbered `/workspace/`-relative output. No `grep` binary. (Pattern
  dialect moves from POSIX BRE to JS regex — closer to what an LLM writes; the schema says so.)
- **Four new `node:fs` tools**, all confined via `BaseWorkspaceTool`: **Find** (name glob —
  `*`/`?`, matched case-insensitively against the base name), **Move** (`fs.rename`), **Copy**
  (`fs.cp`), **Delete** (`fs.rm`; refuses the workspace root; `defaultPermission` = ask — the
  one destructive op). A shared `walk()` generator on `BaseWorkspaceTool` (skips symlinks, so
  it can't escape or loop) backs Find + Grep.
- **`Read` gains an `offset`.** `Bash sed -n` was the only way to read past line 300; Read now
  pages with a 1-based `offset` and points at the next one. No shell needed for long files.

The folder-is-the-tier model, the per-workspace policy, and the never-throw contract all stand.

## Consequences

- The workspace tool set is **identical on Windows, Mac, and Linux** — no host binary, no shell.
  This is also more robust on Linux (no dependency on `grep`/`bash` being on PATH).
- There is no free-form shell, so no pipes/redirect/`&&`/glob composition. For build/git/`sed`
  power-use this is a real loss — out of scope for the target audience, and arbitrary execution
  returns only as the deliberately gated `RunScript` ([ADR-0057](0057-developer-gated-script-execution.md)).
- Adding portable file ops is just dropping `node:fs` tool files in `local/` (ADR-0033's mechanism).
- The read-only agent ceiling now zeroes `Move`/`Copy`/`Delete`/`RunScript` (was `Bash`), and the
  per-workspace permission hint no longer claims "only Bash can step outside" — nothing steps outside.
