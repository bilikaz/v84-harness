# ADR-0074: Session identity vs. runtime — `session.meta`, stored whole

Status: Accepted
Date: 2026-06-30
Refines remote-mirrors-harness-shapes ([ADR-0071](0071-remote-mirrors-harness-shapes.md)) and the
per-entity repos ([ADR-0043](0043-per-entity-repos.md)); amends
[conventions/canonical-shapes.md](../conventions/canonical-shapes.md) rule 6. Present-tense map:
[architecture/storage.md](../architecture/storage.md).

## Context

[ADR-0071](0071-remote-mirrors-harness-shapes.md) made the remote mirror every session field as a typed
column with a parity guard. That's right for identity, but the per-turn **churning** fields
(`usedTokens`, `lastModel`, `errorKind`, `bytes`, `unread`, and now `delivered`) forced a column + schema
migration each time one was added — migration 003 added four at once, `delivered` would be a fifth — even
though none of them is ever queried or indexed on the remote. They are pure round-trip state, growing
schema churn and a per-field pack/unpack mapping that has to stay in sync between local and remote.

## Decision

**Split a session into IDENTITY and RUNTIME, and give RUNTIME one shape stored whole.**

- **Identity** (constants that place/identify a session: `container`/`parent`/`agent`/`graph` ids,
  `title`, `system`, `tools`) stays typed columns — queryable, indexable, parity-guarded per field.
- **Runtime** (the churning fields) moves under **`session.meta`** (`SessionRuntime`). It is flat NOWHERE:
  the desktop carries `session.meta`, the remote stores that object **whole** in a single `meta_data` JSON
  column (`JSON.stringify` in / `JSON.parse` out — no per-field mapping), and the local blob stores it
  unchanged. **One shape end to end, no remap between backends.**
- The parity guard ([ADR-0071](0071-remote-mirrors-harness-shapes.md)) checks `meta` as **one** field; its
  contents are intentionally **not** individually guarded. A new runtime flag is therefore a desktop-only
  change — add it to `SessionRuntime`, never flat on `Session`, and it round-trips with no schema work.

This refines [ADR-0071](0071-remote-mirrors-harness-shapes.md): a cohesive group of runtime fields rides
as one opaque, parity-guarded JSON value rather than per-field columns — still one canonical shape, still
mirrored, just grouped (see the canonical-shapes rule-6 amendment).

## Consequences

- The per-field pack/unpack and the migration-per-flag churn are both gone; the remote round-trips the
  bag blind.
- The split is enforced by the type: there is no flat `session.usedTokens` to drift onto.
- **Breaking** for the remote schema (`sessions` loses the churning columns, gains `meta_data`) — shipped
  under the 0.2.0 wipe ([ADR-0075](0075-breaking-change-data-reset.md)).
- The same identity-vs-runtime line is the natural place to add future churning state (e.g. live progress)
  without touching the server.
