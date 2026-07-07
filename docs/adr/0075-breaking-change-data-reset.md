# ADR-0075: Breaking data changes reset, not migrate — wipe + version gate

Status: Accepted
Date: 2026-06-30
Applies [conventions/canonical-shapes.md](../conventions/canonical-shapes.md) rule 5 ("resetting with the
owner's sign-off is often cheaper than migrating low-value local state"). Present-tense map:
[architecture/storage.md](../architecture/storage.md), [architecture/knowledge.md](../architecture/knowledge.md).

## Context

Pre-1.0, a genuinely breaking data-shape change (this session's session/message reshape) can be absorbed
two ways: migrate the stored data and carry old-shape readers, or reset the data. Carrying readers is the
translation layer that canonical-shapes warns sneaks back in; the data here is low-value (dev profiles,
re-creatable chats). Both realms — the remote MySQL and the local sqlite/idb — need an explicit reset
lever, not ad-hoc destruction.

## Decision

**A breaking data change resets rather than migrates, gated on a version bump.**

- **Remote (MySQL):** the breaking change **wipes** the database and the schema is folded into a single
  canonical `001-init.sql` — the proper first setup, not a sequence of incremental ALTERs to a database
  nobody preserves. The migration **runner** (`schema_migrations`, numbered files) is kept on purpose: the
  first NON-breaking change, once live data can no longer be wiped, lands as `002-…` with no machinery to
  rebuild.
- **Local (sqlite/idb):** local data carries a `DATA_VERSION` stamp (`v84-harness:data-version`,
  [core/storage/version.ts](../../apps/desktop/src/core/storage/version.ts)). On boot, an **older** stamp
  wipes the local provider (`StorageRepos.wipe()` — implemented by sqlite/idb/memory; the remote refuses)
  and re-seeds fresh. An **unstamped** install is **grandfathered** (stamped, not wiped) — a
  forward-compatible shape change (unknown fields drop, missing ones default) keeps the user's data.
- **0.2.0 is the first reset:** the remote is wiped; the local reshape is forward-compatible (old rows
  load, runtime state just resets), so local is grandfathered and chat history is kept.

## Consequences

- No back-compat readers accumulate; the version gate is the explicit, owner-signed-off lever
  canonical-shapes rule 5 calls for, rather than silent destruction or perpetual translation.
- Wiping is destructive and irreversible — it only ever fires on a deliberate `DATA_VERSION` bump (local)
  or an out-of-band MySQL wipe (remote), never on ordinary shape drift.
- This is a pre-1.0 stance. Once there is data that can't be wiped, breaking changes must migrate; the
  retained runner is what that path uses.
