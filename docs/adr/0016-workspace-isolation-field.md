# ADR-0016: Workspace isolation field (`worktree` | `direct`)

Status: **debatable — no concept yet** (field shipped, behavior not designed)
Date: 2026-06-10

## Context

`Workspace.isolation` ("worktree per session" vs "work directly in the folder")
exists in the store, is persisted, and is user-settable in WorkspaceSettings —
but **nothing reads it**. Every session currently works directly against the
workspace root (path-confined per ADR-0007). Review flagged it as a dead field;
the roadmap intent (parallel agents without clobbering each other's files)
is real, but there is no design for it yet.

## Decision

Keep the field, record the truth:

- **Current behavior:** all sessions run `direct`, whatever the setting says.
- **Status: debatable.** No concept exists for what `worktree` means
  concretely — open questions include: when is the worktree created/removed
  (per session? per turn?), what happens to uncommitted changes when a session
  ends, how non-git workspaces behave, how results merge back, and where the
  worktrees live. The feature must be designed (and get its own ADR) before
  any implementation.
- The UI keeps the selector so existing workspace configs don't churn, but the
  unimplemented state is listed in [docs/adr/README.md](README.md) under
  "needs review" until the design lands.

## Consequences

- Future readers know the field is intent, not behavior — no one debugs why
  their "worktree" session writes to the real folder believing isolation works.
- The design debt is tracked in one visible place instead of implied by a
  silent enum.
