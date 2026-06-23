# ADR-0061: Sub-agent alias from the title `#n` suffix

Status: Accepted
Date: 2026-06-23
Supersedes the "stored short aliases" clause of
[ADR-0058](0058-conversational-sub-agent-orchestration.md) (the rest of 0058 stands). Present-tense map:
[architecture/agents.md](../architecture/agents.md).

## Context

ADR-0058 addressed sub-agents by a **stored** per-parent alias — a dedicated `Session.alias` field, assigned
in `createSession` and persisted. In practice the field didn't survive a restart: rehydrated children came
back with `alias` undefined, so the roster and reply tags showed `agent (id: undefined)` and the orchestrator
could no longer address its own team. A separate persisted field is one more thing to migrate, backfill, and
keep in sync with the durable row model — and it was already the source of the addressing carrying nothing.

## Decision

**The alias is derived from the child's title, not stored as its own field.** At spawn, `createSession`
appends a ` #n` suffix to a child's title (`n` = the next free index among that parent's children).
`aliasOf(session)` parses the trailing `#n` (`/#(\d+)\s*$/`); everything that addresses a child
(`resolveChild`, the roster, reply tags, `getAgentContent`) goes through it. The `Session.alias` field is
removed.

- The id is **visible in the UI** (the title literally reads `… #3`), so the handle the model uses and the
  label the user sees are the same string.
- It **survives restart for free** — the title is already persisted; there is no extra field to migrate.
- **Pre-existing children** spawned before this scheme have no `#n` suffix → `aliasOf` returns `0` and they
  stay unaddressable. Accepted: only newly-spawned children need stable handles, and the alternative is a
  one-off backfill of disposable session-scoped runs.
- ULIDs still never reach the model ([llm-interfaces.md](../conventions/llm-interfaces.md) rule 3) — the `#n`
  is the only address.

## Consequences

- Addressing is restart-stable with no migration, and the id is self-evident in the sidebar.
- The title now carries semantics (its `#n` tail is parsed), so title edits must preserve the suffix — the
  suffix is appended once at creation and not user-editable in the child-run UI.
- ADR-0058's first bullet (`Session.alias`, persisted, assigned in `createSession`) is superseded; its
  addressing *intent* (stable per-parent short id, lenient resolution, ULIDs internal) is unchanged.
