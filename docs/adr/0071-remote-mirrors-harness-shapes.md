# ADR-0071: Remote storage mirrors the harness canonical shapes

Status: Accepted
Date: 2026-06-29
Refines the end-to-end shape rule ([ADR-0030](0030-unified-call-target.md)), the per-entity repos
([ADR-0043](0043-per-entity-repos.md)) and the storage-engine provider swap ([ADR-0044](0044-storage-engine-provider-swap.md)).
Present-tense map: [architecture/storage.md](../architecture/storage.md). Convention: [conventions/canonical-shapes.md](../conventions/canonical-shapes.md).

## Context

The same `StorageRepos` shape spans backends that are **not equally shape-faithful**. The local
backends store whole-object blobs — SQLite is `(id, data)` with `data = JSON.stringify(entity)`
([sqliteStore.ts](../../apps/desktop/src/electron/sqliteStore.ts)), IndexedDB is an object store keyed
by `id`. They are lossless by construction: a field added to the model rides along automatically. The
remote backend (`apps/knowledge`) is the opposite — typed SQL columns with an explicit DTO mapping
(schema → repo `put`/`toEntity` → router). Any field without a column is **silently dropped**.

So a field added to the harness (desktop) model "just works" locally and is invisibly lost on the
remote, surfacing only when that field changes behaviour while connected. This bit us three ways at
once: `graphId` (graph sessions reverted to plain chats on restart), agent `tools`/`workspace` (the
tool-ceiling grounding wiped — the remote even renamed them to `permissions`/`requires_workspace` so
nothing mapped), and message `files`. The remote had also grown `placement`/typed names ahead of the
desktop (the per-row placement redesign), deepening the divergence.

## Decision

**The harness (desktop) canonical shape is the source of truth; every backend mirrors it field-for-field
under the same names. We adopt the harness side by default — the remote adapts, never the reverse.**

- The remote schema, DTO, repo mapping and router carry **every** field of the canonical entity, same
  names. No remote-only renames of a synced field.
- Shape changes are **migrations that rename/preserve** data, not drop + re-add ([004-harness-shape.sql](../../apps/knowledge/src/database/migrations/004-harness-shape.sql)).
- A **compile-time parity guard** ([apps/knowledge/src/database/parity.ts](../../apps/knowledge/src/database/parity.ts))
  asserts each server DTO covers the canonical field set. Adding a field to a harness entity means adding
  it to the guard's key union, which won't compile until the DTO (hence schema + repo + router) carries it.
- Server-only redesign concepts with no harness equivalent (`placement`, the typed `requires_workspace`)
  are **dropped** for now. The per-row placement redesign re-enters **on both sides together**, when the
  desktop `StorageEngine` actually routes by placement — today `repos()` is a wholesale provider swap
  ([engine.ts:29](../../apps/desktop/src/core/storage/engine.ts#L29)), so `placement` had no desktop consumer.

## Consequences

- Remote round-trips the whole entity again; `graphId`, agent grounding, and `files` survive a connected restart.
- The lossy-backend trap is named and mechanically guarded, not left to memory — see the convention.
- The guard fires under `pnpm typecheck` only; tests/typecheck are not yet in CI (ADR README "Needs review"),
  so until that closes it catches drift locally, not on push.
- The placement redesign is explicitly deferred, not abandoned — reconciling the desktop and remote models
  (and resolving the agents local-vs-active-provider question, [agents.ts](../../apps/desktop/src/core/agents.ts) vs [engine.ts](../../apps/desktop/src/core/storage/engine.ts)) is its own future ADR.
